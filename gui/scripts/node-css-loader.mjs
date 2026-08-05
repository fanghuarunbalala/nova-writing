/**
 * Node ESM loader stub：把 .css 导入替换为空模块。
 * 供在 Node 中直接加载 dist 的 smoke（renderer-bootstrap / desktop-web-shell-parity）
 * 使用——CSS 由 Vite 消费，Node 侧仅需组件可挂载。
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".css")) {
    return {
      url: new URL(specifier, context.parentURL ?? import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".css")) {
    return { format: "module", source: "export default {};", shortCircuit: true };
  }
  return nextLoad(url, context);
}
