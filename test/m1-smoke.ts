/** M1 冒烟测试：node test/m1-smoke.ts（Node ≥ 22.6 直接跑 TS） */
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHarnessServices } from '../src/index.ts';
import { groupScope, userScope } from '../src/conv.ts';

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed += 1;
    console.log('  ✓ ' + name);
  } else {
    const line = name + (detail ? ' — ' + detail : '');
    failures.push(line);
    console.log('  ✗ ' + line);
  }
}

function eq<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qq-harness-m1-'));
  console.log('workspace: ' + root);

  console.log('[1] 工作区骨架（§2.2）');
  const svc = await createHarnessServices({ workspace: root });
  check('manifest.json 已创建', await exists(path.join(root, 'manifest.json')));
  const dirs = ['state', 'memory', 'memory/groups', 'memory/users', 'memes', 'memes/images'];
  const dirOk = await Promise.all(dirs.map((d) => exists(path.join(root, d))));
  check('目录骨架齐全', dirOk.every(Boolean), dirs.filter((_, i) => !dirOk[i]).join(','));
  check('非降级', svc.workspace.degraded === false);

  console.log('[2] 记忆读写与优先级（§7.1 user > group > global）');
  await svc.memory.add({ scope: 'global', kind: 'fact', text: '主人喜欢深夜写代码', importance: 0.9, tags: ['作息'] });
  await svc.memory.add({ scope: groupScope('g100'), kind: 'event', text: '周五群里团建', importance: 0.6 });
  await svc.memory.add({ scope: userScope('u007'), kind: 'preference', text: 'u007 不吃香菜', importance: 0.6, tags: ['饮食'] });
  const hits = await svc.memory.retrieve({ scopes: [groupScope('g100'), userScope('u007')], text: '香菜' });
  check('查询命中条目排第一', hits[0]?.scope === 'user:u007', JSON.stringify(hits.map((h) => h.scope)));
  check('未命中条目降权但保留', hits.length >= 2, 'len=' + hits.length);
  const limited = await svc.memory.retrieve({ scopes: [groupScope('g100'), userScope('u007')], limit: 2 });
  check('limit 生效', limited.length === 2, 'len=' + limited.length);
  check('hitCount 递增', (hits[0]?.hitCount ?? 0) >= 1);
  check('writeTargets 群聊=群+人', eq(
    svc.conv.writeTargetsForTurn({ convId: 'g100', type: 'group', userId: 'u007' }),
    ['group:g100', 'user:u007'],
  ));
  check('writeTargets 私聊=仅 user', eq(
    svc.conv.writeTargetsForTurn({ convId: 'c2c-9', type: 'private', userId: 'u007' }),
    ['user:u007'],
  ));

  console.log('[3] 去重合并（§7.3）');
  await svc.memory.add({ scope: userScope('u007'), kind: 'preference', text: ' U007 不吃香菜 ', importance: 0.95 });
  const uList = svc.memory.list(userScope('u007'));
  check('同文合并为一条', uList.length === 1, 'len=' + uList.length);
  check('importance 取最大', uList[0]?.importance === 0.95, String(uList[0]?.importance));
  check('tags 并集', uList[0]?.tags.includes('饮食') === true);

  console.log('[4] 遗忘（§7.4）');
  check('关键词删除计数', (await svc.memory.removeByKeyword(groupScope('g100'), '团建')) === 1);
  check('忘掉我清空 user', (await svc.memory.forgetUser('u007')) === 1);
  check('再次忘掉返回 0', (await svc.memory.forgetUser('u007')) === 0);

  console.log('[5] 表情包存储区（§8）');
  check('byTag 空池返回 undefined', svc.memes.byTag('happy') === undefined);
  const m1 = await svc.memes.learn({ file: 'meme-001.png', tag: 'happy', caption: '开心跳舞', keywords: ['开心', '舞'] });
  const m2 = await svc.memes.learn({ file: 'sub/dir/meme-002.gif', tag: 'daily', caption: '摸鱼日常', keywords: ['摸鱼'] });
  check('learn 归一化文件名', m1?.file === 'meme-001.png' && m2?.file === 'meme-002.gif',
    'm1=' + m1?.file + ' m2=' + m2?.file);
  check('byTag 命中', svc.memes.byTag('happy')?.tag === 'happy');
  check('byQuery 命中', svc.memes.byQuery('摸鱼')?.caption === '摸鱼日常');
  check('byQuery 多 token 需全中', svc.memes.byQuery('摸鱼 开心') === undefined);
  check('tagList 枚举', eq(svc.memes.tagList(), ['daily', 'happy']));
  await svc.memes.markUsed(m1!.id);
  check('useCount++', svc.memes.list().find((e) => e.id === m1!.id)?.useCount === 1);
  const img = path.join(root, 'probe-src.png');
  await fs.writeFile(img, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const m3 = await svc.memes.importImage(img, { tag: 'shy', caption: '害羞' });
  check('importImage 拷贝入 images/', m3 !== null && (await exists(path.join(root, 'memes/images', m3.file))));
  check('update 元数据', (await svc.memes.update(m1!.id, { caption: '开心蹦迪' }))?.caption === '开心蹦迪');
  check('remove', (await svc.memes.remove(m3!.id)) === true && svc.memes.list().length === 2);

  console.log('[6] 持久化重载');
  const svc2 = await createHarnessServices({ workspace: root });
  check('记忆重载（只剩 global 一条）', svc2.memory.count() === 1, 'count=' + svc2.memory.count());
  check('表情索引重载 useCount', svc2.memes.list().find((e) => e.id === m1!.id)?.useCount === 1);
  check('索引文件存在', await exists(path.join(root, 'memory/index.json')));

  console.log('[7] 降级态（§11 工作区不可写）');
  const degBase = await fs.mkdtemp(path.join(os.tmpdir(), 'qq-harness-deg-'));
  const fileRoot = path.join(degBase, 'not-a-dir');
  await fs.writeFile(fileRoot, 'occupied');
  const svc3 = await createHarnessServices({ workspace: fileRoot });
  check('initWorkspace 报降级', svc3.workspace.degraded === true);
  check('记忆禁用且不抛错', (await svc3.memory.add({ scope: 'global', kind: 'fact', text: 'x' })) === null);
  check('表情禁用且不抛错', (await svc3.memes.learn({ file: 'a.png' })) === null);
  check('检索仍可用（空结果）', eq(await svc3.memory.retrieve({ scopes: [userScope('u1')] }), []));

  console.log('结果: ' + passed + ' 通过, ' + failures.length + ' 失败');
  if (failures.length > 0) {
    console.log('失败项:\n - ' + failures.join('\n - '));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('冒烟测试崩溃:', err);
  process.exitCode = 1;
});
