// 示例任务数据
const sampleTasks = [
    {
        id: 1,
        goal: '学习 JavaScript 基础',
        suggestion: '每天学习 30 分钟，结合实际项目练习',
        measures: '阅读 MDN 文档，完成 5 个练习题，写一个小应用',
        knowledge: '变量、函数、数组、对象、DOM 操作',
        suggestedTime: 30
    },
    {
        id: 2,
        goal: '完成 CSS 布局练习',
        suggestion: '从简单到复杂，逐步掌握各种布局方式',
        measures: '练习 Flexbox 和 Grid 布局，实现 3 个响应式页面',
        knowledge: 'Flexbox、Grid、响应式设计、媒体查询',
        suggestedTime: 45
    },
    {
        id: 3,
        goal: '阅读技术文档',
        suggestion: '选择一个感兴趣的技术栈，深入阅读官方文档',
        measures: '每天阅读 20 页，做笔记，总结核心概念',
        knowledge: '文档阅读方法、技术选型、架构设计',
        suggestedTime: 60
    }
];

// 从 localStorage 获取任务状态
function getTaskStates() {
    const states = localStorage.getItem('taskStates');
    return states ? JSON.parse(states) : {};
}

// 保存任务状态到 localStorage
function saveTaskStates(states) {
    localStorage.setItem('taskStates', JSON.stringify(states));
}

// 格式化时间显示
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// 创建任务卡片 DOM
function createTaskCard(task, state) {
    const card = document.createElement('div');
    card.className = `task-card ${state.status === 'completed' ? 'completed' : ''}`;
    card.dataset.id = task.id;

    card.innerHTML = `
        <div class="goal">${task.goal}</div>
        <div class="section">
            <div class="section-label">建议：</div>
            <div class="section-content">${task.suggestion}</div>
        </div>
        <div class="section">
            <div class="section-label">具体措施：</div>
            <div class="section-content">${task.measures}</div>
        </div>
        <div class="section">
            <div class="section-label">知识点：</div>
            <div class="section-content">${task.knowledge}</div>
        </div>
        <div class="time">建议完成时间：${task.suggestedTime} 分钟</div>
        <div class="buttons">
            <button class="btn-accept" data-id="${task.id}">接取</button>
            <button class="btn-complete" data-id="${task.id}" disabled>完成</button>
        </div>
    `;

    return card;
}

// 更新卡片状态
function updateCardState(taskId, state) {
    const card = document.querySelector(`.task-card[data-id="${taskId}"]`);
    if (!card) return;

    const acceptBtn = card.querySelector('.btn-accept');
    const completeBtn = card.querySelector('.btn-complete');

    if (state.status === 'pending') {
        acceptBtn.textContent = '接取';
        acceptBtn.disabled = false;
        acceptBtn.className = 'btn-accept';
        completeBtn.disabled = true;
    } else if (state.status === 'in-progress') {
        acceptBtn.textContent = formatTime(state.remainingTime);
        acceptBtn.disabled = true;
        acceptBtn.className = 'btn-accept countdown';
        completeBtn.disabled = false;
    } else if (state.status === 'completed') {
        acceptBtn.textContent = '已接取';
        acceptBtn.disabled = true;
        acceptBtn.className = 'btn-accept';
        completeBtn.textContent = '已完成';
        completeBtn.disabled = true;
        card.classList.add('completed');
    }
}

// 接取任务
function acceptTask(taskId, task) {
    const states = getTaskStates();
    states[taskId] = {
        status: 'in-progress',
        remainingTime: task.suggestedTime * 60,
        startTime: Date.now()
    };
    saveTaskStates(states);
    updateCardState(taskId, states[taskId]);
}

// 完成任务
function completeTask(taskId) {
    const states = getTaskStates();
    states[taskId] = {
        status: 'completed',
        remainingTime: 0
    };
    saveTaskStates(states);
    updateCardState(taskId, states[taskId]);
}

// 倒计时逻辑
function startCountdown() {
    const states = getTaskStates();
    let hasActiveTask = false;

    for (const [taskId, state] of Object.entries(states)) {
        if (state.status === 'in-progress') {
            hasActiveTask = true;
            state.remainingTime--;

            if (state.remainingTime <= 0) {
                state.remainingTime = 0;
                alert(`任务倒计时结束！`);
                states[taskId] = {
                    status: 'completed',
                    remainingTime: 0
                };
            }

            saveTaskStates(states);
            updateCardState(taskId, states[taskId]);
        }
    }

    if (hasActiveTask) {
        setTimeout(startCountdown, 1000);
    }
}

// 初始化页面
function init() {
    const container = document.getElementById('task-container');
    const states = getTaskStates();

    sampleTasks.forEach(task => {
        // 如果没有状态记录，初始化为 pending
        if (!states[task.id]) {
            states[task.id] = {
                status: 'pending',
                remainingTime: task.suggestedTime * 60
            };
            saveTaskStates(states);
        }

        const card = createTaskCard(task, states[task.id]);
        container.appendChild(card);
        updateCardState(task.id, states[task.id]);
    });

    // 绑定按钮事件
    container.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-accept') && !e.target.disabled) {
            const taskId = parseInt(e.target.dataset.id);
            const task = sampleTasks.find(t => t.id === taskId);
            acceptTask(taskId, task);
            startCountdown();
        } else if (e.target.classList.contains('btn-complete') && !e.target.disabled) {
            const taskId = parseInt(e.target.dataset.id);
            completeTask(taskId);
        }
    });

    // 检查是否有进行中的任务，如果有则启动倒计时
    const hasInProgress = Object.values(states).some(s => s.status === 'in-progress');
    if (hasInProgress) {
        startCountdown();
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);
