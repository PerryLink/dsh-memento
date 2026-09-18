// client/globals.d.ts — 客户端面的环境声明（浏览器全局 + 宿主平台模块）。
//
// 本文件是**脚本**声明（无 import/export）：`declare module` 只有在脚本里才是
// 环境模块声明（在模块文件里会变成"对已存在模块的增强"，而本仓并不依赖 react）。
//
// client.js 不是 Node 模块：宿主把它当 classic script 注入页面，执行时经
// window.__ModuleLoader__.load 注册 factory，factory 拿到的 require 是宿主
// 模块系统（react 等平台内置模块）。这里声明这两件事，让客户端类型门
// （tsconfig.check.client.json）量到真实契约，而不是靠 any 蒙过去。

interface Window {
  /** 宿主注入的模块表：load 注册 factory，同 id 重复 load 会留孤儿工厂。 */
  __ModuleLoader__?: {
    load(entry: { id: string, factory: (require: (id: string) => any) => unknown }): void
  }
}

/**
 * 宿主平台内置的 react。本插件只用 createElement（不引 JSX 编译），
 * 因此这里只声明登记到的那些面；其余用法一律应为类型错误。
 */
declare module 'react' {
  const react: {
    createElement: (type: unknown, props?: unknown, ...children: unknown[]) => unknown
  }
  export = react
}
