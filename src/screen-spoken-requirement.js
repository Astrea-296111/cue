'use strict';
// Only interviewer speech that explicitly refers to the visible code/task is
// eligible; unrelated conversation is not promoted into a screen instruction.
const CODE = /代码|程序|函数|方法|变量|报错|编译|运行|调试|屏幕|这道题|这个题|样例|测试用例|输入|输出|循环|数组|链表|树|算法|SQL|bug|debug|\b(?:main|class|return|print)\b/i;
function select(snapshot) {
  const parts=(snapshot?.segments||[]).map(x=>String(x.text||'').trim()).filter(Boolean);
  const relevant=parts.filter(text=>CODE.test(text));
  return relevant.slice(-3).join('\n').slice(-6000);
}
module.exports={select};
