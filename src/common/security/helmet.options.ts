import type { HelmetOptions } from 'helmet';

export type CspMode = 'enforce' | 'report-only' | 'off';

/**
 * 安全响应头。
 *
 * 为什么这不是「顺手加个通用中间件」：后台控制台不是独立站点，而是由
 * ServeStaticModule 挂在**同端口同源**的 /console。一个带完整管理权限登录态的
 * HTML 界面和全部 API 共享一个源，于是
 *   - 缺 frame-ancestors / X-Frame-Options → /console 可被任意站点 iframe 嵌套，
 *     点击劫持能直接借管理员登录态触发发币、改配置
 *   - 缺 CSP → 后台页面上任何一处 XSS 都能直取管理员令牌
 * 而后台恰恰是权限最高的地方。API 侧（JSON 不执行）危害有限，真正暴露的是那个界面。
 */
export function buildHelmetOptions(cspMode: CspMode): HelmetOptions {
  return {
    // frameguard 与下面 CSP 的 frame-ancestors 是同一件事的新旧两种写法。
    // 两个都留：CSP 处于 report-only 时，实际挡住点击劫持的是这个头。
    frameguard: { action: 'deny' },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: false },
    referrerPolicy: { policy: 'no-referrer' },
    contentSecurityPolicy: cspMode === 'off' ? false : cspPolicy(cspMode),
  };
}

function cspPolicy(mode: CspMode) {
  return {
    reportOnly: mode === 'report-only',
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      /*
       * 不给 'unsafe-inline'：Umi 的生产产物里 index.html 无任何内联 <script>，
       * 打包结果也不含 eval/new Function（两点都可复现，见附录 G 的核对命令）。
       * 若将来引入需要内联脚本的三方组件，宁可改打包方式也不要在这里开口子——
       * script-src 一旦放开 'unsafe-inline'，整条 CSP 对 XSS 就基本失效了。
       */
      scriptSrc: ["'self'"],
      /*
       * 这里必须给 'unsafe-inline'：antd 的 CSS-in-JS（@ant-design/cssinjs）在运行时
       * 往 <head> 注入 <style>，nonce/hash 都覆盖不到动态注入。
       * 拦掉的表现是「页面样式全丢但控制台只有几条 CSP 报错」，极易被误判成构建问题。
       */
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
      // 控制台只调同源的 /admin/*；接口若将来要连外部域名，在这里显式列出
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  };
}
