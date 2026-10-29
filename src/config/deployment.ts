/**
 * 部署配置（由开发/实施人员在打包前维护，现场施工人员无需修改）
 *
 * 打包前只需改这里的值：
 *  - defaultEndpoint：项目实际部署的服务地址。内网用 http + 局域网 IP，
 *    公网必须 https；结尾不要带 /api（接口路径由程序拼）。
 *  - allowCustomEndpoint：是否允许现场在「设置」里改地址。
 *    交付现场建议设为 false，用户打开 App 即可登录，不需要接触任何 IP。
 */
export const DEPLOYMENT = {
  /** 默认服务地址：未在设置里保存过地址时使用 */
  defaultEndpoint: 'http://10.120.136.176:7001',
  /** 现场是否可改服务器地址（false 时设置页隐藏地址输入） */
  allowCustomEndpoint: true,
} as const;

/** 取生效的服务地址：本机已保存的优先，其次用部署默认值。 */
export function resolveEndpoint(saved?: string) {
  return (saved || '').trim() || DEPLOYMENT.defaultEndpoint;
}
