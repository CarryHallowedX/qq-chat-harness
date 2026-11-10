// 构建脚本：把 src 下的 .ts 编译到 dist 下的 .js。
// 用 Node 内置 stripTypeScriptTypes（mode=strip，Node 22.13+）：只做类型剥离，
// 不做语法降级——宿主内嵌 Node v24.21 跑得动我们的语法。
// 相对导入的 .ts 后缀一并改写成 .js（dist 里都是 .js，运行时 import 才找得到）。
// 用法：node scripts/build-dist.mjs
import { stripTypeScriptTypes } from 'node:module';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcDir = path.join(pkgRoot, 'src');
const distDir = path.join(pkgRoot, 'dist');

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const files = await walk(srcDir);
let count = 0;
for (const file of files) {
  const code = await fs.readFile(file, 'utf8');
  let js = stripTypeScriptTypes(code, { mode: 'strip' });
  // 相对导入 './x.ts' 改写为 './x.js'（含 from/import/动态 import 的字符串字面量）
  js = js.replace(/(['"])(\.{1,2}\/[^'"\n]+?)\.ts\1/g, (m, q, p) => q + p + '.js' + q);
  const rel = path.relative(srcDir, file).slice(0, -3) + ".js";
  const out = path.join(distDir, rel);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, js);
  console.log("dist/" + rel.split(path.sep).join("/"));
  count += 1;
}
console.log("共编译 " + count + " 个文件 -> dist/");
