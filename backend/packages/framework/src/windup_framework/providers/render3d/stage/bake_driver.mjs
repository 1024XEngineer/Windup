/**
 * 出帧台的无头驱动。由 LocalSpriteRenderProvider 起,通过环境变量传参,产物落盘后由 Python 读回。
 *
 * 为什么是"落盘再读回"而不是把 bytes 直接回传:一次 8 向 × 12 帧 = 96 张 PNG,
 * 走 stdout 传 base64 既慢又会把 JSON 撑爆;而临时目录本来就是 provider 建的、用完就删。
 *
 * 环境变量:
 *   STAGE_URL     出帧台页面 URL(已带 model / mat / w / h 查询串)
 *   OUT           产物目录
 *   DIRS          JSON:[["e",0],["n",90],...] 朝向名 → 相机方位角(度)
 *   CLIP          片段名;缺省用第一个
 *   N             每个朝向的帧数
 *   MIN_COVERAGE  空帧自检阈值(非透明像素占比),默认 0.005
 *   PLAYWRIGHT_MODULE  playwright 的入口路径(本机全局装的时候要指);缺省按包名解析
 *
 * 退出码:0 正常;2 空帧自检不通过(**不让全透明帧冒充成功**);1 其它错误。
 */
import fs from 'node:fs';
import path from 'node:path';

const {
  STAGE_URL, OUT, DIRS, CLIP, N = '12', MIN_COVERAGE = '0.005', PLAYWRIGHT_MODULE,
} = process.env;

const pw = await import(PLAYWRIGHT_MODULE || 'playwright');
const dirs = JSON.parse(DIRS);
const n = +N;
const minCov = +MIN_COVERAGE;

// 用 playwright 自带的 chromium,不指定 channel:'chrome'。品牌版 Chrome 要另外装,
// 容器镜像里没有,于是渲帧段在任何容器里都起不来(实测报 "Chromium distribution
// 'chrome' is not found")。也不做"先试 chrome 再退回"的链 —— 出帧结果依赖具体
// 浏览器,静默换一个等于同一份模型在不同机器上出不同的帧。
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
const errs = [];
page.on('pageerror', e => errs.push(String(e.message)));
page.on('console', m => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errs.push(m.text()); });

try {
  await page.goto(STAGE_URL, { waitUntil: 'domcontentloaded' });
  // 模型可能有几十 MB,加载 + 解析要时间。__ready 由页面末尾置位;它没来就是页面炸了,
  // 把捕获到的页面错误一起报出来 —— 否则只剩一句 timeout,看不出是模型坏了还是脚本坏了。
  await page.waitForFunction('window.__ready===true', { timeout: 180000 })
    .catch(e => { throw new Error(`出帧台没就绪:${e.message}\n页面错误:${[...new Set(errs)].join(' | ') || '(无)'}`); });

  const clips = await page.evaluate(() => window.__clips());
  const names = Object.keys(clips);
  if (!names.length) throw new Error('模型里没有任何动画片段 —— 绑骨时没带 MotionType?');
  const clip = CLIP && CLIP.length ? CLIP : names[0];
  if (!clips[clip]) throw new Error(`模型里没有片段 ${JSON.stringify(clip)};有的是 ${JSON.stringify(names)}`);

  const rig = await page.evaluate(() => window.__rigInfo());
  const rootMotion = await page.evaluate(() => window.__rootMotion());

  const meta = { clip, duration: clips[clip], clips, rig, root_motion: rootMotion[clip] ?? null,
                 frames: n, directions: {}, sample_times: [], coverage: {} };
  const empties = [];

  for (const [name, yaw] of dirs) {
    await page.evaluate(y => window.__setCamYaw(y), yaw);
    const outDir = path.join(OUT, name);
    fs.mkdirSync(outDir, { recursive: true });
    const times = [], covs = [];
    for (let i = 0; i < n; i++) {
      const info = await page.evaluate(([c, i, n]) => window.__setup(c, i, n), [clip, i, n]);
      if (!info) throw new Error(`__setup 拿不到片段 ${clip}`);
      const cov = await page.evaluate(() => window.__coverage());
      const dataUrl = await page.evaluate(() => window.__grab());
      // 形状守卫:空画布时 toDataURL 会给出 "data:," 这类没有 base64 段的串,
      // 切出来是空字符串,会写成一张 0 字节 PNG —— 而 _collect 只按文件存在与否
      // 收帧,于是坏帧一路当成正常产物交付。覆盖率自检是第二道,这里先炸得更早更清楚。
      const b64 = typeof dataUrl === 'string' ? dataUrl.split(',')[1] : '';
      if (!b64) throw new Error(`${name}/f${i} 截图为空(dataURL=${String(dataUrl).slice(0, 32)})`);
      fs.writeFileSync(path.join(outDir, `f${String(i).padStart(2, '0')}.png`),
                       Buffer.from(b64, 'base64'));
      times.push(info.t); covs.push(+cov.toFixed(5));
      if (cov < minCov) empties.push(`${name}/f${String(i).padStart(2, '0')} 覆盖率 ${cov.toFixed(5)}`);
    }
    meta.directions[name] = { yaw, dir: outDir, frames: n };
    meta.coverage[name] = covs;
    if (!meta.sample_times.length) meta.sample_times = times;
  }

  meta.page_errors = [...new Set(errs)];
  fs.writeFileSync(path.join(OUT, 'bake_meta.json'), JSON.stringify(meta, null, 2));

  if (empties.length) {
    // 空帧自检:台子可以静默产出全透明帧(角色出画 / 片段选错),外面照样以为成功了。
    console.error(`空帧自检不通过,${empties.length} 帧几乎全透明:\n  ` + empties.join('\n  '));
    process.exit(2);
  }
  console.log(JSON.stringify({ ok: true, clip, dirs: dirs.length, frames: n,
                               page_errors: meta.page_errors.length }));
} finally {
  await browser.close();
}
