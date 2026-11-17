# 工作台插件 SDK v1

一个插件包是一个 UTF-8 JSON 文件，常用扩展名为 .mlw-plugin.json。工作台按清单装配组件。可以在「设置 → 插件」下载附带的学习计数器或目标倒计时，用同一个流程安装自写包或他人分享的工作台插件包。

## 写一个插件

把下面的清单保存为 session-counter.mlw-plugin.json，在「设置 → 插件」选取文件并安装。同一 ID 的包可以替换，布局和各实例数据通过 ID 继续关联。在已安装列表可将插件加入首页。在任意课程的「编辑布局」中也可添加插件组件。每个位置独立保存配置和状态。

~~~json
{
  "format": "mlw-plugin",
  "apiVersion": 1,
  "id": "session-counter",
  "name": "复习计数",
  "version": "1.0.0",
  "description": "记录本门课程复习完成的次数。",
  "fields": [
    { "key": "unit", "label": "计数单位", "kind": "text", "default": "次复习" }
  ],
  "code": "const count = Number(input.state.count ?? 0) + (input.action === 'add' ? 1 : 0); return { state: { count }, view: [{ kind: 'metric', value: String(count), label: input.settings.unit }, { kind: 'button', id: 'add', label: '记一次' }] };"
}
~~~

## 接口与限制

- 清单 ID 应保持稳定，版本格式为三段数字，例如 1.2.0。菜单名称和字段标签可用中文。字段支持 text、number、checkbox、date。date 的默认值可为空或 YYYY-MM-DD。字段键、插件 ID 和按钮 ID 可用字母、数字、短横线和下划线。
- code 是异步 JavaScript 函数的函数体，可直接使用 input 和 await。input.settings 是当前组件声明的用户配置，input.state 是该实例的上一次状态，input.action 初次渲染为 null，点击按钮时为按钮 ID，input.today 为 ISO 日期时间。
- 返回值形如 { view, state? }。最多 15 个视图节点。text 节点使用 kind、text；metric 节点使用 kind、value、label；button 节点使用 kind、id、label。状态由字符串、数值、布尔值组成，一次按钮操作返回 state 时工作台会保存。渲染由宿主处理。
- 运行时在不共享来源的沙箱页面里启动一次性 Web Worker。仅接收前述实例数据，连接网络和访问工作台 API 受 CSP 限制。代码没有同源 DOM、Node、Shell 或授权文件接口。超时及格式错误在组件里显示。新版工作台的第三方扩展点是首页和课程组件。
- 源码随工作台配置备份导出。停用保留配置和状态。卸载会移除包与其首页实例，课程实例仍保留，重装同 ID 后恢复。安装与替换的上限为 16 个包。

工作台插件包采用本页协议。其他宿主的现成插件需要适配其清单、界面和权限接口。装配思想参考 [DeepSeek Harness 架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.zh.md)。
