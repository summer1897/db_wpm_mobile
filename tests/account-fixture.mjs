/** 隔离服务的注册资料；管理员用例统一补齐必填姓名，业务及权限校验仍由真实接口处理。 */
import { createMobileService } from '../server/service.mjs';
export async function createTestMobileService(options) {
  const service = await createMobileService(options);
  const registrationFields = (input) => ({
    ...input,
    ...(input.role === 'admin' ? { name: input.name || '测试管理人员' } : {}),
  });
  return { ...service, registrationFields };
}
