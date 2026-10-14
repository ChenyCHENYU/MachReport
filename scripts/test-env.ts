// 单元测试没有静态字体服务；新增自动 HEAD 预检查应得到确定的“资源未部署”。
// 字体检查用例显式 mock fetch 以覆盖成功/失败；浏览器 E2E 使用真实字体资源。
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const method = init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET");
  if (method.toUpperCase() === "HEAD") return Promise.resolve(new Response(null, { status: 404 }));
  return nativeFetch(input, init);
};
