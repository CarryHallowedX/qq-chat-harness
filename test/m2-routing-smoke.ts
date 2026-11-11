/** M2-lite 冒烟测试：记忆区块/预设绑定解析 + 会话记忆存储 + agents 拦截层（node test/m2-routing-smoke.ts） */
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { JsonStore } from '../src/storage.ts';
import {
  resolveMemberBlock,
  resolvePresetBinding,
  markMemberGroups,
  buildStatusMarkdown,
  SessionMemoryStore,
} from '../src/memory/blocks.ts';
import type { PresetBindingConfig } from '../src/memory/blocks.ts';
import { AgentsHook, parseSessionKey } from '../src/agents-hook.ts';

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

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function mkAgent(preset: string, sid: string): Record<string, unknown> {
  return {
    _preset: preset,
    session: { header: { id: sid } },
    followup: async (_m: unknown) => 'raw-fu',
    cancel: async () => {},
  };
}

async function main(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qq-harness-m2-'));
  console.log('workspace: ' + root);

  console.log('[1] parseSessionKey');
  const k1 = parseSessionKey('qqbot:1906366445:group:C9D89686');
  check('群聊 key 解析', !!k1 && k1.kind === 'group' && k1.appId === '1906366445' && k1.peerId === 'C9D89686');
  const k2 = parseSessionKey('qqbot:app:c2c:ABC');
  check('私聊 key 解析', !!k2 && k2.kind === 'c2c' && k2.peerId === 'ABC');
  check('非法 key 返回 null', parseSessionKey('weird:thing') === null && parseSessionKey('') === null);

  console.log('[2] 记忆区块归属：用户原例（openid1 被通配收编）');
  const blocks = [
    { name: '区块1', members: ['openid1'] },
    { name: '区块2', members: ['群聊'] },
  ];
  const r = resolveMemberBlock(blocks, 'group', 'openid1');
  check('openid1 归区块2（通配优先）', r.blockIndex === 2 && r.via === 'wildcard' && r.blockName === '区块2', JSON.stringify(r));
  const rSolo = resolveMemberBlock(blocks, 'c2c', 'someone');
  check('未命中 → solo（blockIndex=0）', rSolo.blockIndex === 0 && rSolo.via === 'none');
  const known = new Map([['openid1', 'group' as const]]);
  const marks = markMemberGroups(blocks, known);
  const m1 = marks[0]?.find((x) => x.value === 'openid1');
  const m2 = marks[1]?.find((x) => x.value === '群聊');
  check('区块1 的 openid1 标灰（被 群聊@区块2 遮蔽）', !!m1 && !m1.effective && m1.shadowedBy === '群聊@区块2', JSON.stringify(m1));
  check('区块2 的 群聊 生效', !!m2 && m2.effective && !m2.shadowedBy);

  console.log('[3] 通配首中 / openid 首中 / 待定标记');
  const blocks2 = [
    { name: '', members: ['群聊', 'g9'] },
    { name: '', members: ['群聊', 'g9'] },
  ];
  const marks2 = markMemberGroups(blocks2, new Map([['g9', 'group' as const]]));
  check('通配第二个区块标灰', marks2[1]?.find((x) => x.value === '群聊')?.shadowedBy === '群聊@区块1');
  check('通配首个区块生效', marks2[0]?.find((x) => x.value === '群聊')?.effective === true);
  const g9m = marks2[0]?.find((x) => x.value === 'g9');
  check('g9 归首个包含它的区块（通配遮蔽下仍标灰）', !!g9m && !g9m.effective && !!g9m.shadowedBy, JSON.stringify(g9m));
  const marks3 = markMemberGroups([{ name: 'X', members: ['unknown-peer'] }], new Map());
  check('类型未知 → 待定（pending）', marks3[0]?.[0]?.pending === true, JSON.stringify(marks3[0]?.[0]));

  console.log('[4] 会话预设绑定解析');
  const bindings: PresetBindingConfig[] = [
    { presetId: 'ptc', members: ['群聊'] },
    { presetId: 'minimal', members: ['u9'] },
  ];
  check('群聊通配 → ptc', resolvePresetBinding(bindings, 'group', 'gx').presetId === 'ptc');
  check('u9 openid → minimal', resolvePresetBinding(bindings, 'c2c', 'u9').presetId === 'minimal');
  check('未绑定 → 空', resolvePresetBinding(bindings, 'c2c', 'other').presetId === '');

  console.log('[5] SessionMemoryStore：区块互通 / solo 隔离 / 全局并入 / 去重合并 / 只删自己');
  const store = new JsonStore(root);
  const now = Date.now();
  await store.writeJson('memory/global.json', {
    version: 1,
    entries: [{ id: 'g1', kind: 'fact', text: '全局事实', tags: [], importance: 0.9, createdAt: now }],
  });
  const mem = new SessionMemoryStore(store, () => [{ name: 'B1', members: ['u1'] }]);
  const refU1 = { kind: 'c2c' as const, peerId: 'u1', key: 'qqbot:app:c2c:u1' };
  await mem.add(refU1, { kind: 'preference', text: '用户喜欢猫', tags: ['宠物'], importance: 0.6 });
  await mem.add(refU1, { kind: 'preference', text: '用户喜欢猫', tags: ['宠物'], importance: 0.8 });
  const own = await mem.listOwn(refU1);
  check('重复文本合并为一条', own.length === 1, 'len=' + own.length);
  check('合并取最大重要度', own[0]?.importance === 0.8);
  check('合并打 hitCount', own[0]?.hitCount === 1);
  const readU1 = await mem.readForSession(refU1);
  check('区块会话读到 全局+自己', readU1.some((e) => e.id === 'g1') && readU1.some((e) => e.text === '用户喜欢猫'), JSON.stringify(readU1.map((e) => e.id)));
  const refSolo = { kind: 'c2c' as const, peerId: 'u9', key: 'qqbot:app:c2c:u9' };
  await mem.add(refSolo, { kind: 'fact', text: '独区事实', tags: [], importance: 0.5 });
  const readSolo = await mem.readForSession(refSolo);
  check('solo 只见 全局+自己（不见 B1）', readSolo.some((e) => e.text === '独区事实') && !readSolo.some((e) => e.text === '用户喜欢猫'), JSON.stringify(readSolo.map((e) => e.text)));
  const removed = await mem.removeOwn(refU1, '猫');
  check('removeOwn 命中删除', removed === 1 && (await mem.listOwn(refU1)).length === 0);
  const fileU1 = await store.readJson<unknown>('memory/blocks/B1/sessions/' + 'qqbot_app_c2c_u1.json', null);
  check('文件落在区块目录', Array.isArray(fileU1) || (fileU1 as { entries?: unknown[] } | null)?.entries !== undefined);

  console.log('[6] AgentsHook：create 改写 meta.agentPreset + setup + 归因');
  const prefsFile = path.join(root, 'prefs.json');
  await fs.writeFile(
    prefsFile,
    JSON.stringify({ sessionIds: { 'qqbot:app:group:G1': 'session-a', 'qqbot:app:c2c:U1': 'session-new' } }),
    'utf8',
  );
  let bindingsLive: PresetBindingConfig[] = [{ presetId: 'ptc', members: ['群聊'] }];
  const logs: { level: string; msg: string }[] = [];
  const createCalls: Record<string, unknown>[] = [];
  const resumeCalls: Record<string, unknown>[] = [];
  let lastCompose = '';
  let resumeFailOnSetup = false;
  let disposeCount = 0;
  let liveAgent: Record<string, unknown> | null = null;
  const fakeAgents = {
    create: async (o: Record<string, unknown>) => {
      createCalls.push(o ?? {});
      const meta = (o?.meta ?? {}) as { agentPreset?: string };
      return { agent: mkAgent(meta.agentPreset ?? 'none', String(o?.sessionId ?? '?')), dispose: async () => { disposeCount += 1; } };
    },
    resume: async (o: Record<string, unknown>) => {
      resumeCalls.push(o ?? {});
      if (resumeFailOnSetup && o?.setup && lastCompose === 'ptc') throw new Error('mock resume fail');
      const preset = o?.setup ? lastCompose : 'birth-preset';
      return { agent: mkAgent(preset, String(o?.resumeSessionId ?? '?')), dispose: async () => {} };
    },
    get: (id: string) => (id === 'session-get' ? liveAgent : undefined),
  };
  const hook = new AgentsHook({
    workspaceRoot: root,
    prefsPath: prefsFile,
    getConfig: () => ({ memoryBlocks: [], presetBindings: bindingsLive }),
    composePreset: async (id: string) => {
      lastCompose = id;
      return { agentPreset: id, setup: async () => {} };
    },
    log: (level, msg) => logs.push({ level, msg }),
    pollAttempts: 2,
    pollIntervalMs: 10,
  });
  await hook.install(fakeAgents as unknown as Record<string, unknown>);
  const created = (await fakeAgents.create({ sessionId: 'session-a', meta: { agentPreset: 'standard' } })) as { agent: Record<string, unknown> };
  const c0 = createCalls[createCalls.length - 1] ?? {};
  const c0meta = (c0.meta ?? {}) as { agentPreset?: string };
  check('create 被改写为路由预设 ptc', c0meta.agentPreset === 'ptc', JSON.stringify(c0meta));
  check('create 注入 setup', typeof (c0 as { setup?: unknown }).setup === 'function');
  check('返回句柄的 agent 是代理（proxyStateOf 可见）', !!hook.proxyStateOf('session-a'));
  await sleep(50);
  check('归因落 state（session-a → qqbot:app:group:G1）', hook.keyOfSessionId('session-a') === 'qqbot:app:group:G1', String(hook.keyOfSessionId('session-a')));
  check('出生预设记录为 ptc', hook.getObserved().find((o) => o.sessionId === 'session-a')?.presetId === 'ptc');

  console.log('[7] AgentsHook：followup 热切换（dispose → 同 id resume → 换 target）');
  bindingsLive = [{ presetId: 'standard', members: ['群聊'] }];
  const fu = await (created.agent as { followup: (m: string) => Promise<string> }).followup('hi');
  check('followup 透传返回', fu === 'raw-fu');
  await sleep(30);
  const st = hook.proxyStateOf('session-a');
  check('热切换后 current._preset=standard', st?.current?._preset === 'standard', String(st?.current?._preset));
  check('旧句柄被 dispose（放锁）', disposeCount === 1, 'disposeCount=' + disposeCount);
  check('resume 以同 id 调用', (resumeCalls[resumeCalls.length - 1] ?? {}).resumeSessionId === 'session-a');
  check('成功日志', logs.some((l) => l.msg.includes('热切换 → standard')));

  console.log('[8] AgentsHook：换装失败 → 回滚旧预设');
  bindingsLive = [{ presetId: 'ptc', members: ['群聊'] }];
  resumeFailOnSetup = true;
  let threw = false;
  try {
    await (created.agent as { followup: (m: string) => Promise<string> }).followup('again');
  } catch {
    threw = true;
  }
  check('followup 不抛错（内部降级）', !threw);
  await sleep(30);
  check('回滚后 current._preset=standard（birth 恢复）', st?.current?._preset === 'standard', String(st?.current?._preset));
  check('回滚日志（且非「回滚失败」）', logs.some((l) => l.msg.includes('已回滚旧预设 standard')) && !logs.some((l) => l.msg.includes('回滚失败')));

  console.log('[9] AgentsHook：新 peer 轮询归因 + 私聊路由');
  bindingsLive = [{ presetId: 'ptc', members: ['私聊'] }];
  await fakeAgents.create({ sessionId: 'session-new' });
  await sleep(60);
  check('session-new 归因到 qqbot:app:c2c:U1', hook.keyOfSessionId('session-new') === 'qqbot:app:c2c:U1', String(hook.keyOfSessionId('session-new')));
  const obsNew = hook.getObserved().find((o) => o.sessionId === 'session-new');
  check('session-new kind=c2c 且路由=ptc', obsNew?.kind === 'c2c' && obsNew?.routedPreset === 'ptc', JSON.stringify(obsNew));

  console.log('[10] AgentsHook：get 包代理幂等 / 不假造 undefined');
  liveAgent = mkAgent('standard', 'session-get');
  const got = fakeAgents.get('session-get') as Record<symbol, unknown>;
  check('live agent 被包成代理（HARNESS 可见）', typeof got === 'object' && got[Symbol.for('qq-chat-harness:proxy')] !== undefined);
  check('未知会话返回 undefined（不假造）', fakeAgents.get('missing') === undefined);

  console.log('[11] AgentsHook：dispose 还原');
  hook.dispose();
  check('create 已还原为原方法', typeof fakeAgents.create === 'function' && !(fakeAgents.create as { __wrapped?: boolean }).__wrapped);

  console.log('[12] 状态表 Markdown');
  const md = buildStatusMarkdown({
    blocks,
    bindings: [{ presetId: 'ptc', members: ['群聊'] }],
    observed: [
      { key: 'qqbot:app:group:G1', kind: 'group', peerId: 'G1', sessionId: 'session-a', presetId: 'ptc', routedPreset: 'ptc', createdAt: now },
    ],
    knownKinds: known,
    availablePresets: ['standard', 'ptc', 'minimal'],
    generatedAt: now,
  });
  await fs.writeFile(path.join(root, '记忆区块-生效表.md'), md, 'utf8');
  check('包含灰标 ⛔ 与遮蔽来源', md.includes('⛔') && md.includes('群聊@区块2'));
  check('包含生效标记 ✅', md.includes('✅'));
  check('包含会话映射行', md.includes('qqbot:app:group:G1') && md.includes('session-a'));
  check('包含可用预设清单', md.includes('- ptc'));

  console.log('');
  console.log('合计: ' + passed + ' 通过, ' + failures.length + ' 失败');
  if (failures.length) {
    console.log('失败清单:');
    for (const f of failures) console.log('  ✗ ' + f);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('冒烟崩溃:', e);
  process.exit(1);
});
