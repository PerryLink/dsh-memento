// test/fixtures/mock-webserver.mjs — Loader 组装测试用的 webServer 替代品：
// 与真实宿主一致，重复 exact 路由抛 duplicate route，register 返回摘除该路由
// 的 disposer；list() 供 runner 断言存活路由数。
export const name = 'mock-webserver'
export const inject = []

export function apply(ctx) {
  const routes = new Map()
  ctx.provide('webServer', {
    register(route) {
      if (routes.has(route.path)) throw new Error(`duplicate exact route: ${route.path}`)
      routes.set(route.path, route)
      return () => { routes.delete(route.path) }
    },
    list() { return [...routes.keys()] },
  })
}
