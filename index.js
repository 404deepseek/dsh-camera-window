// 心灵之窗 · dsh-camera-window
// 接入摄像头，让 agent 看看你的样子和外面的世界。
//
// 设计要点：抓帧脚本内联在本文件里，运行时写到固定目录再执行。
// 不依赖 import.meta.url 定位包内文件——否则装到不同位置、或 DSH 模块缓存还没重载时，
// 会去找旧的源码路径而报「找不到 camera-grab.py」。
// 依赖：Python 3.9+ 与 opencv-python（或 opencv-python-headless）。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const exec = promisify(execFile)

export const name = 'dsh-camera-window'
export const inject = ['tools']

const SCRIPT_VERSION = '3'
const SCRIPT_BODY = String.raw`#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""摄像头抓帧：抓一帧存 JPEG，供 agent 看。

用法:
  python camera-grab.py <输出路径.jpg> [摄像头索引]
  python camera-grab.py --list          列出可用摄像头
"""
import sys
import os
import json

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def _open_camera(index):
    """按后端优先级尝试打开：MSMF 在 Windows 上最稳，DSHOW 次之。"""
    import cv2
    for backend in (cv2.CAP_MSMF, cv2.CAP_DSHOW, cv2.CAP_ANY):
        try:
            cap = cv2.VideoCapture(index, backend)
            if cap.isOpened():
                return cap
            cap.release()
        except Exception:
            continue
    return None


def list_cameras(max_index=6):
    found = []
    for i in range(max_index):
        cap = _open_camera(i)
        if cap is not None:
            ok, frame = cap.read()
            if ok and frame is not None:
                h, w = frame.shape[:2]
                found.append({"index": i, "width": int(w), "height": int(h)})
            cap.release()
    return found


def grab(out_path, index=0, warmup=8):
    import cv2
    cap = _open_camera(index)
    if cap is None:
        return {"ok": False, "code": "CAMERA_NOT_OPENED",
                "notice": "摄像头打不开：可能没插、被别的程序占用（微信/相机 App），或者索引不对。用 --list 看看有几个。"}
    try:
        frame = None
        for _ in range(max(1, warmup)):
            ok, f = cap.read()
            if ok and f is not None:
                frame = f
        if frame is None:
            return {"ok": False, "code": "CAMERA_NO_FRAME",
                    "notice": "能打开但读不到画面：可能被独占，或驱动没就绪。"}
        h, w = frame.shape[:2]
        os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)
        # cv2.imwrite 不支持中文路径，走 imencode + 写字节
        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        if not ok:
            return {"ok": False, "code": "CAMERA_ENCODE_FAILED", "notice": "画面拿到了但编码失败。"}
        with open(out_path, "wb") as fh:
            fh.write(buf.tobytes())
        return {"ok": True, "path": os.path.abspath(out_path),
                "width": int(w), "height": int(h),
                "bytes": os.path.getsize(out_path)}
    finally:
        cap.release()


def main():
    args = [a for a in sys.argv[1:]]
    if not args:
        print(json.dumps({"ok": False, "code": "USAGE",
                          "notice": "用法: camera-grab.py <输出.jpg> [索引] | --list"}, ensure_ascii=False))
        return 2
    if args[0] in ("--list", "-l"):
        try:
            cams = list_cameras()
            print(json.dumps({"ok": True, "cameras": cams,
                              "notice": ("没找到摄像头，先插上。" if not cams else "找到 %d 个。" % len(cams))},
                             ensure_ascii=False))
            return 0
        except Exception as e:
            print(json.dumps({"ok": False, "code": "LIST_FAILED", "notice": str(e)}, ensure_ascii=False))
            return 1
    out = args[0]
    idx = int(args[1]) if len(args) > 1 else 0
    try:
        r = grab(out, idx)
    except Exception as e:
        r = {"ok": False, "code": "CAMERA_EXCEPTION", "notice": str(e)}
    print(json.dumps(r, ensure_ascii=False))
    return 0 if r.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
`

const DEP_HINT = '抓帧需要 Python + opencv。缺了就在终端跑一次：python -m pip install opencv-python-headless'

function workDir(configured) {
  const dir = configured && String(configured).trim()
    ? String(configured).trim()
    : path.join(os.homedir(), '.dsh', 'camera-window')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 把内联脚本写到工作目录；内容不一致才覆盖。 */
function ensureScript(dir) {
  const file = path.join(dir, `camera-grab.v${SCRIPT_VERSION}.py`)
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === SCRIPT_BODY) return file
  } catch { /* 写入失败就走下面重写 */ }
  fs.writeFileSync(file, SCRIPT_BODY, 'utf8')
  return file
}

function resolvePython(configured) {
  if (configured && fs.existsSync(configured)) return configured
  const cands = [
    process.env.DSH_CAMERA_PYTHON,
    process.env.DSH_PYTHON,
    process.env.PYTHON,
    process.platform === 'win32' ? 'python.exe' : 'python3',
    'python3',
    'python',
  ].filter(Boolean)
  return cands[0]
}

async function runPython(python, args, timeout = 60000) {
  const { stdout, stderr } = await exec(python, args, {
    timeout,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  })
  return { stdout: String(stdout), stderr: String(stderr) }
}

function parseResult(stdout) {
  const line = String(stdout).trim().split(/\r?\n/).filter(Boolean).pop() ?? '{}'
  try { return JSON.parse(line) } catch { return { ok: false, code: 'BAD_OUTPUT', notice: line.slice(0, 300) } }
}

function fail(notice, code = 'CAMERA_ERROR') {
  return { content: JSON.stringify({ ok: false, code, notice }), isError: true }
}

function ok(payload) {
  return { content: JSON.stringify(payload), isError: false }
}

const outputSchema = {
  schema: {
    type: 'object',
    properties: { content: { type: 'string' }, isError: { type: 'boolean' } },
    required: ['content', 'isError'],
    additionalProperties: false,
  },
  render: (_args, value) => [{ type: 'text', text: value.content }],
}

export function apply(ctx, config = {}) {
  const cfg = {
    pythonPath: '',
    outDir: '',
    defaultIndex: 0,
    ...config,
  }

  const call = async (args, timeout) => {
    const dir = workDir(cfg.outDir)
    const script = ensureScript(dir)
    const python = resolvePython(cfg.pythonPath)
    try {
      return { result: await runPython(python, [script, ...args], timeout) }
    } catch (error) {
      const msg = String(error?.stderr || error?.message || error)
      return { error: /No module named ['"]?cv2/.test(msg) ? DEP_HINT : `调用 Python 失败：${msg.slice(0, 300)}` }
    }
  }

  const grab = ctx.tools.register({
    name: 'camera_grab',
    description: '用摄像头拍一张照片，返回图片绝对路径（JPEG）。想看看用户的样子、桌上的东西、房间时用它；拿到路径后用 read_image 打开看。',
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string', description: '拍摄说明，比如「看桌上的键盘」，仅记录用途。' },
        index: { type: 'integer', minimum: 0, maximum: 8, description: '摄像头索引，默认 0。' },
      },
      additionalProperties: false,
    },
    output: outputSchema,
    async execute(args = {}) {
      const dir = workDir(cfg.outDir)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const out = path.join(dir, `cam-${stamp}.jpg`)
      const idx = Number.isInteger(args.index) ? args.index : cfg.defaultIndex
      const { result, error } = await call([out, String(idx)])
      if (error) return fail(error, 'CAMERA_CALL_FAILED')
      const parsed = parseResult(result.stdout)
      if (!parsed.ok) {
        const notice = /No module named ['"]?cv2/.test(result.stderr) ? DEP_HINT : (parsed.notice ?? '抓帧失败')
        return fail(notice, parsed.code ?? 'CAMERA_FAILED')
      }
      return ok({
        ok: true,
        path: parsed.path,
        width: parsed.width,
        height: parsed.height,
        bytes: parsed.bytes,
        note: args.note ?? '',
        next: '用 read_image 打开这个路径看画面；想看清细节就裁剪放大那一块。',
      })
    },
  })

  const list = ctx.tools.register({
    name: 'camera_list',
    description: '列出当前可用的摄像头（索引与分辨率）。camera_grab 打不开时先用它确认。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: outputSchema,
    async execute() {
      const { result, error } = await call(['--list'], 90000)
      if (error) return fail(error, 'CAMERA_LIST_FAILED')
      const parsed = parseResult(result.stdout)
      if (!parsed.ok) {
        const notice = /No module named ['"]?cv2/.test(result.stderr) ? DEP_HINT : (parsed.notice ?? '枚举失败')
        return fail(notice, parsed.code ?? 'CAMERA_LIST_FAILED')
      }
      const cams = parsed.cameras ?? []
      return ok({
        ok: true,
        cameras: cams,
        notice: cams.length ? `找到 ${cams.length} 个摄像头` : '没找到摄像头：插上、换 USB 口，或关掉占用它的程序（微信/相机 App）。',
      })
    },
  })

  return () => {
    try { grab?.() } catch {}
    try { list?.() } catch {}
  }
}
