import { getFreeSeats, bookSeat } from '../api/client';

/**
 * 定时预约执行器
 * 在 app 前台或后台运行时，检查并执行到期的定时任务
 */

let pollingInterval = null;

/**
 * 检查并执行一个定时任务
 */
export async function executeTask(task) {
  if (!task.enabled) return { success: false, message: '任务已禁用' };

  try {
    // 1. 获取空闲座位
    const seatsResp = await getFreeSeats(task.roomId, task.date);
    if (!seatsResp.status || !seatsResp.data) {
      return { success: false, message: '获取座位信息失败' };
    }

    const freeSeats = Object.values(seatsResp.data).filter(
      (s) => s.status === 'FREE'
    );

    if (freeSeats.length === 0) {
      return { success: false, message: '没有空闲座位' };
    }

    // 2. 如果有偏好座位，优先选择
    let targetSeat = freeSeats[0];
    if (task.preferredSeats) {
      const preferred = task.preferredSeats.split(',').map((s) => s.trim());
      const found = freeSeats.find((s) => preferred.includes(s.label));
      if (found) targetSeat = found;
    }

    // 3. 解析时间
    const startMin =
      parseInt(task.startTime.split(':')[0]) * 60 +
      parseInt(task.startTime.split(':')[1]);
    const endMin =
      parseInt(task.endTime.split(':')[0]) * 60 +
      parseInt(task.endTime.split(':')[1]);

    // 4. 预约
    const bookResp = await bookSeat(
      targetSeat.id,
      task.date,
      startMin,
      endMin,
      'capToken'
    );

    if (bookResp.status) {
      return {
        success: true,
        message: `预约成功: ${targetSeat.label}号座位 ${task.startTime}-${task.endTime}`,
        seat: targetSeat,
      };
    } else {
      return { success: false, message: bookResp.message || '预约失败' };
    }
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * 检查任务是否应该现在执行
 * 规则: 在预约日期的凌晨5点后(系统开放预约时间)执行
 */
export function shouldExecuteNow(task) {
  const now = new Date();
  const taskDate = new Date(task.date + 'T05:00:00');

  // 任务日期必须是今天，且当前时间在凌晨5点之后
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const taskDay = new Date(task.date + 'T00:00:00');

  if (taskDay.getTime() !== today.getTime()) return false;
  if (now.getHours() < 5) return false;
  if (task.lastRun) {
    // 今天已经执行过了就不重复执行
    const lastRun = new Date(task.lastRun);
    if (lastRun.toDateString() === now.toDateString()) return false;
  }

  return true;
}

/**
 * 开始轮询定时任务
 */
export function startScheduledPolling(getTasks, updateTasks) {
  stopScheduledPolling();

  pollingInterval = setInterval(async () => {
    const tasks = await getTasks();
    let changed = false;

    for (const task of tasks) {
      if (shouldExecuteNow(task)) {
        console.log(`[Scheduler] 执行定时任务: ${task.roomName}`);
        const result = await executeTask(task);
        task.lastRun = new Date().toISOString();
        task.lastResult = result.success
          ? `✅ ${result.message}`
          : `❌ ${result.message}`;
        changed = true;
      }
    }

    if (changed) {
      await updateTasks(tasks);
    }
  }, 60000); // 每分钟检查一次
}

/**
 * 停止轮询
 */
export function stopScheduledPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}
