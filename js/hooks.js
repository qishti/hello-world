// Late-bound integration callbacks so the outline editor does not import network code.
export let todoistSend = () => {};
export let todoistToggle = () => {};
export let todoistUpdateDue = () => {};
export let askNotify = () => {};
export function bind(impl) {
  ({ todoistSend, todoistToggle, todoistUpdateDue, askNotify } = { todoistSend, todoistToggle, todoistUpdateDue, askNotify, ...impl });
}
