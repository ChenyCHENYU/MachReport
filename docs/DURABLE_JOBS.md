# 可恢复的报表任务

`/server` 的 `createReportJobService` 把任务提交、幂等、租约、进度、取消、失败与显式重试放到包内；项目提供处理函数和存储适配器。调度由宿主调用 `runNext`，包不隐式启动定时器、HTTP服务或数据库迁移。

```ts
import { createReportJobService } from '@agile-team/mach-report/server';
import { openFileReportJobStore } from '@agile-team/mach-report/server/node';

const store = await openFileReportJobStore({ directory: './report-jobs' });
const jobs = createReportJobService({
  store, concurrency: 1,
  handlers: {
    export: async (payload, context) => {
      const file = await runtime.export({ ...validatedRequest(payload), signal: context.signal });
      // 按 scope+taskId 幂等归档；返回文件引用，不把整个文件塞进任务JSON。
      const artifactId = await archive(context.scope, context.taskId, file);
      await context.reportProgress(1, 1);
      return { artifactId, bytes: file.bytes.byteLength };
    }
  }
});
await jobs.submit({ scope: 'plant:YTS0', id: 'export-20261019', kind: 'export', payload: request });
await jobs.runNext('worker-1');
const task = await jobs.get('plant:YTS0', 'export-20261019');
await jobs.close(); // 发取消信号并等待实际处理函数结束
await store.close();
```

`validatedRequest`、`archive`、业务Runtime由宿主提供。`scope` 必须由认证上下文确定，不能直接信任客户端传入租户或厂别；读取、取消和重试均需项目权限校验。

## 一致性与恢复

- 相同 `scope + id`、相同规范化JSON请求重复提交，返回同一任务；不同内容复用ID返回 `conflict`。
- 存储器必须提供跨实例原子CAS；候选扫描只用于发现任务，最终由CAS领取。默认租约30秒、心跳10秒、并发1。
- 过期租约允许再次领取，`owner + attempt` 阻止旧进程或同名旧worker写回迟到结果。这是**至少一次执行**；外部归档或其他副作用必须按任务身份幂等。
- 取消先保存意图；执行函数响应signal后完成取消。忽略signal的函数仍占真实并发槽位，不能假称资源已释放。多实例取消会在下一次心跳获知。
- 失败进入 `failed`，不会自动循环重试毒丸。`retry(scope,id,expectedRevision)` 仅重试当前修订的失败任务；业务决定退避、重试次数和是否允许重试。
- 心跳存储故障属于失败；不会伪装成用户取消。结果与请求组合超过JSON预算时保存明确失败，而不是不断重新执行大结果。

## Node文件适配器

文件适配器供**单个进程持有目录**的本地持久任务使用，采用目录写锁、0600临时文件、文件fsync、原子rename和目录fsync。任务记录可在关闭再打开后恢复。默认最多1万个记录、64MiB，满额返回 `capacity`，归档保留由宿主治理。

持有独占写锁后，会清理本适配器UUID命名的崩溃临时文件，避免未提交文件绕过容量账本。目录应专用于此适配器，容量预算针对托管的任务记录，不包含宿主另行存放的文件。

默认拒绝已有写锁。确认需要接管已退出进程时，可显式 `recoverDeadOwner: true`；仅对PID不存在的写锁恢复，独立恢复锁避免并发接管相互删除新锁。活动PID、损坏锁均拒绝接管。操作系统重用PID时按仍活动处理，不冒险抢占。恢复进程若在恢复锁期间崩溃，需要运维确认无写入者后处理 `.writer-lock.recovery`；包不自动猜测移除。

多实例、共享文件系统或跨机器任务应使用数据库实现 `ReportJobStore`：读取、候选列表和原子 `compareAndSwap` 三个方法。任务状态和修订一并CAS，不能先读后无条件更新。库不捆绑SQL方言或业务表。

请求和结果只接受有限纯JSON：拒绝访问器、危险键、循环、稀疏数组、非有限数值，最多32层。记录上限2万个节点/100万个序列化字符；请求另限1.9万个节点/75万个字符，为状态和错误保留空间。大数据和文件应保存引用。文件适配器有总容量上限，进程中的内存示例适配器仅用于演示和测试。
