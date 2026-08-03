const https = require('https');
const http = require('http');

const WEBHOOK_URL = process.env.WECOM_BOT_WEBHOOK || '';
const CLOUD_BASE_URL = process.env.CLOUD_BASE_URL || '';
const HR_USERID = process.env.HR_WECOM_USERID || '';
const MANAGER_USERID = process.env.MANAGER_WECOM_USERID || '';
const ADMIN_USERID = process.env.ADMIN_WECOM_USERID || '';

// Maximum practice days before labor risk warning
const MAX_PRACTICE_DAYS = 7;

function sendPayload(payloadObj) {
  if (!WEBHOOK_URL) {
    console.log('[WeCom Bot] Webhook URL not configured, skipping notification');
    return;
  }

  const payload = JSON.stringify(payloadObj);
  const url = new URL(WEBHOOK_URL);
  const lib = url.protocol === 'https:' ? https : http;

  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const req = lib.request(options, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log('[WeCom Bot] Message sent successfully');
      } else {
        console.error('[WeCom Bot] Send failed:', res.statusCode, body);
      }
    });
  });

  req.on('error', (e) => {
    console.error('[WeCom Bot] Request error:', e.message);
  });

  req.write(payload);
  req.end();
}

function sendMarkdown(content) {
  sendPayload({ msgtype: 'markdown', markdown: { content } });
}

function sendText(content, mentionedList) {
  const textObj = { content };
  if (Array.isArray(mentionedList) && mentionedList.length > 0) {
    textObj.mentioned_list = mentionedList;
  }
  sendPayload({ msgtype: 'text', text: textObj });
}

// ==================== @all 通知 ====================

// 问卷提交后 @全员
function notifyQuestionnaireSubmitted(q) {
  const roleText = q.submitterRoleLabel || q.submitterRole || '';
  const content = [
    '【新的实操需求已提交】',
    '提交人：' + q.submitterName + '（' + roleText + '）',
    '实操人员：' + q.personName,
    '建议带教人：' + q.mentorName,
    '期望开始：' + q.expectStart + '（预计' + q.expectDays + '天）',
    '请行政尽快在系统上完成登记'
  ].join('\n');
  sendText(content, ['@all']);
}

// 记录创建后 @全员
function notifyRecordCreated(r) {
  let content = [
    '【新实操人员已登记】',
    '人员：' + r.name,
    '带教人：' + r.mentor,
    '实操周期：' + r.startDate + ' ~ ' + r.endDate + '（' + r.practiceDays + '天）',
    '设备：' + (r.deviceModel || '未登记'),
    '请SSC及时在系统上填写薪资信息'
  ].join('\n');

  // 行政登记后专门@行政人员
  const mentioned = ADMIN_USERID ? [ADMIN_USERID] : ['@all'];
  sendText(content, mentioned);

  // 实操天数超过7天，单独发送风险预警 @HRD + @全员
  if (r.practiceDays > MAX_PRACTICE_DAYS) {
    notifyOver7Days(r);
  }
}

// ==================== @SSC 通知（实操跟进） ====================

// 实操结束前3天 @SSC 跟进实操结果
function notifyDeadline3Day(r) {
  const feedbackLink = CLOUD_BASE_URL ? CLOUD_BASE_URL + '/feedback/' + r.feedbackToken : '';
  let content = [
    '【实操即将到期 - 请跟进反馈】',
    r.name + '的实操还有3天结束（到期日：' + r.endDate + '），请跟进带教人' + r.mentor + '的实操结果反馈。',
    '带教人：' + r.mentor,
    '实操周期：' + r.startDate + ' ~ ' + r.endDate
  ].join('\n');
  if (feedbackLink) {
    content += '\n反馈表单：' + feedbackLink;
  }

  const mentioned = HR_USERID ? [HR_USERID] : [];
  sendText(content, mentioned);
}

// 实操结束前1天 @SSC 再次提醒
function notifyDeadline1Day(r) {
  const feedbackLink = CLOUD_BASE_URL ? CLOUD_BASE_URL + '/feedback/' + r.feedbackToken : '';
  let content = [
    '【实操明天到期 - 紧急跟进】',
    r.name + '的实操还剩1天结束（到期日：' + r.endDate + '），请务必在到期当天完成反馈结果记录并上传凭证。',
    '带教人：' + r.mentor,
    '实操周期：' + r.startDate + ' ~ ' + r.endDate
  ].join('\n');
  if (feedbackLink) {
    content += '\n反馈表单：' + feedbackLink;
  }

  const mentioned = HR_USERID ? [HR_USERID] : [];
  sendText(content, mentioned);
}

// ==================== @HRD 通知（反馈结果 + @全员） ====================

// 反馈结果提交后 @HRD + @全员 通知
function notifyFeedbackSubmitted(r) {
  const resultText = r.feedback.result === 'pass' ? '通过·建议正式入职' : '不通过·结算离场';
  const attendance = r.feedback.attendanceDays + '天（迟到' + r.feedback.lateCount + '次/早退' + r.feedback.earlyLeaveCount + '次）';
  const hasAttachment = r.feedback.attachmentName ? '\n附件：' + r.feedback.attachmentName : '';

  let content = [
    '【实操反馈结果已提交】',
    r.name + '的实操反馈已由' + (r.feedback.by || r.mentor) + '提交',
    '反馈结果：' + resultText,
    '出勤记录：' + attendance,
    '反馈意见：' + (r.feedback.note || '无') + hasAttachment
  ].join('\n');

  if (r.feedback.result === 'pass') {
    content += '\n请@' + (MANAGER_USERID || 'HRD') + '和SSC办理正式入职手续';
  } else {
    content += '\n请SSC尽快办理薪资结算';
  }

  // 反馈提交后 @HRD + @全员
  const mentioned = MANAGER_USERID ? [MANAGER_USERID, '@all'] : ['@all'];
  sendText(content, mentioned);
}

// ==================== @HRD + @SSC 入职通知 ====================

// 办理入职后 @HRD 和 @SSC
function notifyOnboarding(r) {
  const mentioned = [MANAGER_USERID, HR_USERID].filter(Boolean);
  const names = [];
  if (MANAGER_USERID) names.push('@' + MANAGER_USERID);
  if (HR_USERID) names.push('@' + HR_USERID);
  const nameStr = names.length ? names.join(' ') : 'HRD和SSC';

  const content = [
    '【实操通过 - 请办理正式入职】',
    r.name + '已通过实操考核，请' + nameStr + '为其办理正式入职手续。',
    '入职日期：' + (r.onboarding ? r.onboarding.date : ''),
    '带教人：' + r.mentor,
    '实操周期：' + r.startDate + ' ~ ' + r.endDate
  ].join('\n');

  sendText(content, mentioned);
}

// ==================== 到期当天通知组长+@SSC / 逾期@全员 ====================

// 到期当天通知带教人（组长）+ @SSC
function notifyDeadlineToday(r) {
  const feedbackLink = CLOUD_BASE_URL ? CLOUD_BASE_URL + '/feedback/' + r.feedbackToken : '';
  const content = [
    '【实操今日到期】',
    r.name + '的实操今天到期，请带教人' + r.mentor + '尽快填写反馈表单。',
    '实操周期：' + r.startDate + ' ~ ' + r.endDate
  ].join('\n') + (feedbackLink ? '\n反馈表单：' + feedbackLink : '');
  // 同时@SSC跟进
  const mentioned = HR_USERID ? [HR_USERID] : [];
  sendText(content, mentioned);
}

function notifyDeadlineOverdue(r, days) {
  const content = [
    '【反馈逾期' + days + '天 - 需管理层关注】',
    r.name + '的实操已逾期' + days + '天，带教人' + r.mentor + '仍未提交反馈，存在劳动风险，请管理层跟进处理。',
    '实操周期：' + r.startDate + ' ~ ' + r.endDate,
    '⚠️ 劳动风险预警：实操已逾期' + days + '天，请管理层关注！'
  ].join('\n');
  // 逾期3天 @全员
  sendText(content, ['@all']);
}

// ==================== >7天用工风险预警（定时检查） ====================

function notifyOver7Days(r) {
  const content = [
    '⚠️【用工风险预警 - 实操天数超过7天】',
    r.name + '的实操天数为' + r.practiceDays + '天，超过' + MAX_PRACTICE_DAYS + '天建议上限。',
    '带教人：' + r.mentor,
    '实操周期：' + r.startDate + ' ~ ' + r.endDate,
    '请HRD关注用工风险，建议尽快安排结束实操或转为正式入职。',
    'SSC请跟进薪资核算及反馈结果收集事宜。'
  ].join('\n');
  // >7天预警 @HRD + @全员
  const mentioned = MANAGER_USERID ? [MANAGER_USERID, '@all'] : ['@all'];
  sendText(content, mentioned);
}

// ==================== 定时检查 ====================

function checkAndNotifyDeadlines() {
  const { getData } = require('../lib/db');
  const data = getData();
  const today = new Date().toISOString().slice(0, 10);

  let notifications = 0;

  data.records.forEach(r => {
    // >7天用工风险预警（对所有 practicing 记录检查）
    if (r.status === 'practicing' && r.practiceDays > MAX_PRACTICE_DAYS && !r.notified_over7) {
      notifyOver7Days(r);
      r.notified_over7 = true;
      saveDataQuiet();
      notifications++;
    }

    if (r.status !== 'practicing' && r.status !== 'feedback_pending') return;

    const daysDiff = Math.round((new Date(r.endDate) - new Date(today)) / 86400000);

    // T-3: @SSC 跟进实操结果
    if (daysDiff === 3 && !r.notified_t3) {
      notifyDeadline3Day(r);
      r.notified_t3 = true;
      saveDataQuiet();
      notifications++;
    }

    // T-1: @SSC 再次提醒
    if (daysDiff === 1 && !r.notified_t1) {
      notifyDeadline1Day(r);
      r.notified_t1 = true;
      saveDataQuiet();
      notifications++;
    }

    // T-0: 到期当天通知组长 + @SSC
    if (daysDiff === 0 && !r.notified_t0) {
      notifyDeadlineToday(r);
      r.notified_t0 = true;
      saveDataQuiet();
      notifications++;
    }

    // T+3: 逾期3天 @全员
    if (daysDiff === -3 && !r.notified_overdue3) {
      notifyDeadlineOverdue(r, 3);
      r.notified_overdue3 = true;
      saveDataQuiet();
      notifications++;
    }
  });

  if (notifications > 0) {
    console.log('[Scheduler] Sent ' + notifications + ' notification(s) this check');
  }
  return notifications;
}

// 诊断函数：返回当前环境变量配置状态
function getDiagnosticInfo() {
  return {
    webhookConfigured: !!WEBHOOK_URL,
    cloudBaseUrl: CLOUD_BASE_URL || '(empty)',
    hrUserId: HR_USERID || '(empty)',
    managerUserId: MANAGER_USERID || '(empty)',
    adminUserId: ADMIN_USERID || '(empty)',
    maxPracticeDays: MAX_PRACTICE_DAYS
  };
}

let saveTimer = null;
function saveDataQuiet() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      const { saveData } = require('../lib/db');
      await saveData();
    } catch (e) {
      console.error('[Deadline Check] Save error:', e.message);
    }
  }, 2000);
}

function startScheduler() {
  console.log('[Scheduler] Deadline reminder scheduler started (SSC:' + (HR_USERID || 'N/A') + ', HRD:' + (MANAGER_USERID || 'N/A') + ', ADMIN:' + (ADMIN_USERID || 'N/A') + ')');
  const runCheck = () => {
    try {
      checkAndNotifyDeadlines();
    } catch (e) {
      console.error('[Scheduler] Check error:', e.message);
    }
  };

  // 立即检查一次
  runCheck();

  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setMinutes(5, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);
  const delay = nextHour - now;

  setTimeout(() => {
    runCheck();
    setInterval(runCheck, 3600000);
  }, delay);
}

module.exports = {
  sendMarkdown,
  sendText,
  notifyRecordCreated,
  notifyQuestionnaireSubmitted,
  notifyFeedbackSubmitted,
  notifyOnboarding,
  notifyDeadline3Day,
  notifyDeadline1Day,
  notifyDeadlineToday,
  notifyDeadlineOverdue,
  notifyOver7Days,
  checkAndNotifyDeadlines,
  getDiagnosticInfo,
  startScheduler
};
