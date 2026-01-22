// ========================================
// HomeworkHub - Frontend Application
// ========================================

const API_URL = '/api';

// State
let currentUser = null;
let writers = [];
let assignments = [];
let jobBoard = [];
let paymentSummary = [];
let allDomains = [];
let notifications = [];
let chatThreads = [];
let currentChatAssignment = null;
let statusUpdateInterval = null;
let lastNotificationCount = 0;
let notificationSoundEnabled = localStorage.getItem('notificationSound') !== 'false';
let audioContext = null;

// Initialize audio context on first user interaction (required for mobile)
function initAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume if suspended (mobile requirement)
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    return audioContext;
}

// Notification Sound using Web Audio API
function playNotificationSound() {
    if (!notificationSoundEnabled) return;
    
    try {
        const ctx = initAudioContext();
        
        // Create a pleasant chime sound
        const playTone = (freq, startTime, duration) => {
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);
            
            oscillator.frequency.value = freq;
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.4, startTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
            
            oscillator.start(startTime);
            oscillator.stop(startTime + duration);
        };
        
        // Play a pleasant two-tone chime
        const now = ctx.currentTime;
        playTone(830, now, 0.15);        // High note
        playTone(1046, now + 0.15, 0.2); // Higher note
        
    } catch (e) {
        console.log('Audio error:', e);
    }
}

function toggleNotificationSound() {
    // Initialize audio on user interaction
    initAudioContext();
    
    notificationSoundEnabled = !notificationSoundEnabled;
    localStorage.setItem('notificationSound', notificationSoundEnabled);
    updateSoundIcon();
    
    // Play test sound when enabling
    if (notificationSoundEnabled) {
        playNotificationSound();
    }
    
    showToast('info', 'Sound ' + (notificationSoundEnabled ? 'Enabled' : 'Disabled'), 
        notificationSoundEnabled ? 'You will hear notification sounds' : 'Notification sounds are muted');
}

function updateSoundIcon() {
    const icon = document.getElementById('soundIcon');
    if (icon) {
        icon.className = notificationSoundEnabled ? 'fas fa-volume-up' : 'fas fa-volume-mute';
    }
}

// ========================================
// Push Notifications
// ========================================
async function initPushNotifications() {
    console.log('🔔 Initializing push notifications...');
    
    if (!('serviceWorker' in navigator)) {
        console.log('❌ Service Worker not supported');
        return false;
    }
    
    if (!('PushManager' in window)) {
        console.log('❌ Push Manager not supported');
        return false;
    }

    try {
        // Get VAPID public key from server
        const response = await fetch('/api/push/vapid-key');
        const { publicKey } = await response.json();
        
        if (!publicKey) {
            console.log('❌ No VAPID key from server');
            return false;
        }
        console.log('✅ Got VAPID key');

        // Wait for service worker to be ready
        const registration = await navigator.serviceWorker.ready;
        console.log('✅ Service worker ready');
        
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
            console.log('📱 Requesting notification permission...');
            const permission = await Notification.requestPermission();
            console.log('📱 Permission:', permission);
            
            if (permission !== 'granted') {
                console.log('❌ Notification permission denied');
                return false;
            }

            console.log('🔔 Creating push subscription...');
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey)
            });
            console.log('✅ Subscription created');
        } else {
            console.log('✅ Already subscribed');
        }

        // Send subscription to server
        const token = localStorage.getItem('token');
        if (token) {
            const saveRes = await fetch('/api/push/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ subscription })
            });
            
            if (saveRes.ok) {
                console.log('✅ Push subscription saved to server');
                return true;
            } else {
                console.log('❌ Failed to save subscription:', await saveRes.text());
            }
        }
        return true;
    } catch (error) {
        console.error('❌ Push init error:', error);
        return false;
    }
}

// Manual enable push (for settings button)
async function enablePushNotifications() {
    initAudioContext(); // Init audio on user interaction
    
    const result = await initPushNotifications();
    if (result) {
        showToast('success', 'Push Enabled', 'You will receive push notifications');
    } else {
        showToast('error', 'Push Failed', 'Check browser permissions and try again');
    }
}

// Test push notification
async function testPushNotification() {
    try {
        // First check subscription status
        const statusRes = await fetch('/api/push/status', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const status = await statusRes.json();
        
        if (!status.subscribed) {
            showToast('warning', 'Not Subscribed', 'Enable push notifications first');
            return;
        }
        
        // Send test push
        const testRes = await fetch('/api/push/test', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        
        if (testRes.ok) {
            showToast('info', 'Test Sent', `Push sent to ${status.subscriptions} device(s). Check your notifications!`);
        } else {
            showToast('error', 'Test Failed', 'Could not send test notification');
        }
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

// Delayed test push - gives time to close the app
async function testDelayedPush() {
    try {
        const statusRes = await fetch('/api/push/status', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const status = await statusRes.json();
        
        if (!status.subscribed) {
            showToast('warning', 'Not Subscribed', 'Enable push notifications first');
            return;
        }
        
        const testRes = await fetch('/api/push/test-delayed', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ delay: 10 })
        });
        
        if (testRes.ok) {
            showToast('info', '⏱️ Close the app NOW!', 'Push will arrive in 10 seconds');
        }
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

// Helper function to convert VAPID key
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// ========================================
// Telegram Integration
// ========================================
async function checkTelegramStatus() {
    try {
        const response = await fetch('/api/telegram/status', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        if (!response.ok) return { linked: false };
        return await response.json();
    } catch (error) {
        console.error('Telegram status error:', error);
        return { linked: false };
    }
}

async function showTelegramModal() {
    const modal = document.getElementById('telegramModal');
    const body = document.getElementById('telegramModalBody');
    const footer = document.getElementById('telegramModalFooter');
    
    modal.classList.add('active');
    body.innerHTML = `<div class="telegram-status"><i class="fas fa-spinner fa-spin"></i> Checking status...</div>`;
    
    try {
        const status = await checkTelegramStatus();
        
        if (status.linked) {
            const linkedDate = new Date(status.linkedAt).toLocaleDateString();
            body.innerHTML = `
                <div class="telegram-linked">
                    <i class="fab fa-telegram"></i>
                    <p>✅ <strong>Telegram Connected</strong></p>
                    <p class="username">@${status.username || 'Unknown'}</p>
                    <p class="linked-date">Linked on ${linkedDate}</p>
                </div>
            `;
            footer.innerHTML = `
                <button class="btn btn-secondary" data-close="telegramModal">Close</button>
                <button class="btn btn-danger" id="unlinkTelegramBtn">Unlink</button>
            `;
            document.getElementById('unlinkTelegramBtn')?.addEventListener('click', unlinkTelegram);
        } else {
            await generateTelegramCode();
        }
    } catch (error) {
        body.innerHTML = `<div class="telegram-status" style="color:var(--danger)"><i class="fas fa-exclamation-circle"></i> Failed to load</div>`;
    }
}

async function generateTelegramCode() {
    const body = document.getElementById('telegramModalBody');
    const footer = document.getElementById('telegramModalFooter');
    
    try {
        const response = await fetch('/api/telegram/generate-link-code', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Server error');
        }
        
        const data = await response.json();
        
        if (data.code) {
            body.innerHTML = `
                <div class="telegram-unlinked">
                    <p>Link your Telegram to receive notifications even when the app is closed.</p>
                    
                    <div class="telegram-code-box">
                        <div class="telegram-code">${data.code}</div>
                        <small>Code expires in 10 minutes</small>
                    </div>
                    
                    <ol class="telegram-steps">
                        <li>Open <strong>Telegram</strong> on your phone</li>
                        <li>Search for the bot or click the link below</li>
                        <li>Send the code <strong>${data.code}</strong> to the bot</li>
                    </ol>
                    
                    <a href="${data.botLink}" target="_blank" class="telegram-bot-link">
                        <i class="fab fa-telegram"></i> Open Telegram Bot
                    </a>
                </div>
            `;
            footer.innerHTML = `
                <button class="btn btn-secondary" data-close="telegramModal">Cancel</button>
                <button class="btn btn-primary" id="refreshTelegramBtn"><i class="fas fa-sync-alt"></i> Refresh</button>
            `;
            document.getElementById('refreshTelegramBtn')?.addEventListener('click', showTelegramModal);
        }
    } catch (error) {
        console.error('Generate code error:', error);
        body.innerHTML = `<div class="telegram-status" style="color:var(--danger)"><i class="fas fa-exclamation-circle"></i> ${error.message || 'Failed to generate code'}</div>`;
    }
}

async function unlinkTelegram() {
    if (!confirm('Are you sure you want to unlink Telegram? You will no longer receive notifications there.')) return;
    
    try {
        const response = await fetch('/api/telegram/unlink', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        
        if (response.ok) {
            showToast('success', 'Unlinked', 'Telegram unlinked successfully');
            showTelegramModal(); // Refresh modal
        }
    } catch (error) {
        showToast('error', 'Error', 'Failed to unlink Telegram');
    }
}

// ========================================
// Theme Management
// ========================================
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const newTheme = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
}

initTheme();

// ========================================
// API Helper
// ========================================
async function api(endpoint, options = {}) {
    const token = localStorage.getItem('token');
    const config = {
        headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` })
        },
        ...options
    };

    if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
        config.body = JSON.stringify(config.body);
    }
    
    if (config.body instanceof FormData) {
        delete config.headers['Content-Type'];
    }

    const response = await fetch(`${API_URL}${endpoint}`, config);
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || 'Request failed');
    }

    return data;
}

async function uploadFile(endpoint, file, additionalData = {}) {
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('file', file);
    Object.keys(additionalData).forEach(key => {
        formData.append(key, additionalData[key]);
    });
    
    const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`
        },
        body: formData
    });
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Upload failed');
    return data;
}

// ========================================
// Utilities
// ========================================
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
}

// Helper to parse database timestamps
// Neon PostgreSQL stores timestamps in UTC, we need to parse them as UTC then display in local time
function parseDbDate(dateString) {
    if (!dateString) return null;
    // If no timezone indicator, append 'Z' to parse as UTC
    if (typeof dateString === 'string' && !dateString.includes('Z') && !dateString.includes('+') && !dateString.includes('T')) {
        // Format: "2026-01-22 12:24:00" -> "2026-01-22T12:24:00Z"
        dateString = dateString.replace(' ', 'T') + 'Z';
    } else if (typeof dateString === 'string' && dateString.includes('T') && !dateString.includes('Z') && !dateString.includes('+')) {
        dateString = dateString + 'Z';
    }
    return new Date(dateString);
}

function formatDate(dateString) {
    if (!dateString) return '-';
    const date = parseDbDate(dateString);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(dateString) {
    if (!dateString) return '-';
    const date = parseDbDate(dateString);
    return date.toLocaleString(undefined, { 
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function formatTimeAgo(dateString) {
    const date = parseDbDate(dateString);
    if (!date) return '-';
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return formatDate(dateString);
}

function getInitials(name) {
    return name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?';
}

function showToast(type, title, message) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle' };
    toast.innerHTML = `
        <i class="fas ${icons[type]}"></i>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
    `;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 4000);
}

function isAdmin() {
    return currentUser && currentUser.role === 'admin';
}

function copyToClipboard(elementId) {
    const text = document.getElementById(elementId).textContent;
    navigator.clipboard.writeText(text).then(() => {
        showToast('success', 'Copied!', 'Text copied to clipboard');
    });
}

function getDeadlineClass(deadline) {
    const now = new Date();
    const deadlineDate = new Date(deadline);
    const hoursLeft = (deadlineDate - now) / (1000 * 60 * 60);
    
    if (hoursLeft < 0) return 'deadline-urgent';
    if (hoursLeft < 24) return 'deadline-urgent';
    if (hoursLeft < 72) return 'deadline-soon';
    return 'deadline-ok';
}

// ========================================
// Authentication
// ========================================
async function login(email, password) {
    try {
        const data = await api('/auth/login', {
            method: 'POST',
            body: { email, password }
        });
        
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        currentUser = data.user;
        
        showApp();
        showToast('success', 'Welcome!', `Logged in as ${data.user.name}`);
        
        if (data.user.must_change_password) {
            showToast('warning', 'Password Change Required', 'Please change your password');
            openModal('passwordModal');
        }
    } catch (error) {
        document.getElementById('loginError').textContent = error.message;
        throw error;
    }
}

function logout() {
    if (statusUpdateInterval) clearInterval(statusUpdateInterval);
    updateOnlineStatus(false);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    currentUser = null;
    notifications = [];
    document.getElementById('loginPage').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
    document.body.classList.remove('role-admin', 'role-writer');
}

function checkAuth() {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    
    if (token && user) {
        currentUser = JSON.parse(user);
        showApp();
    } else {
        document.getElementById('loginPage').style.display = 'flex';
        document.getElementById('mainApp').style.display = 'none';
    }
}

function showApp() {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('mainApp').style.display = 'flex';
    
    document.getElementById('currentUserName').textContent = currentUser.name;
    document.getElementById('currentUserRole').textContent = currentUser.role === 'admin' ? 'Administrator' : 'Writer';
    document.getElementById('dashboardGreeting').innerHTML = `Welcome back, <span>${currentUser.name.split(' ')[0]}</span>!`;
    document.getElementById('userInitials').textContent = getInitials(currentUser.name);

    // Set role class on body
    document.body.classList.remove('role-admin', 'role-writer');
    document.body.classList.add(`role-${currentUser.role}`);

    // Update labels for writers
    if (!isAdmin()) {
        document.getElementById('assignmentsNavLabel').textContent = 'My Jobs';
        document.getElementById('assignmentsPageTitle').textContent = 'My Jobs';
    }

    // Show appropriate stats
    document.getElementById('adminStats').style.display = isAdmin() ? 'grid' : 'none';
    document.getElementById('writerStats').style.display = isAdmin() ? 'none' : 'grid';

    // Start online status updates
    updateOnlineStatus(true);
    statusUpdateInterval = setInterval(() => updateOnlineStatus(true), 60000);

    // Initialize push notifications
    initPushNotifications();

    loadDashboard();
    loadNotifications();
    loadAssignments();
    loadPayments();
    loadUnreadCount();
    
    if (isAdmin()) {
        loadWriters();
        loadExtensionRequests();
    } else {
        loadJobBoard();
    }
}

async function updateOnlineStatus(online) {
    try {
        await api('/messages/status', { method: 'POST', body: { online } });
    } catch (e) { /* ignore */ }
}

// ========================================
// Navigation
// ========================================
function navigateTo(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    const pageEl = document.getElementById(`${page}-page`);
    const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
    
    if (pageEl) pageEl.classList.add('active');
    if (navEl) navEl.classList.add('active');
    
    // Update page title
    const titles = {
        'dashboard': 'Dashboard',
        'job-board': 'Job Board',
        'writers': 'Writers',
        'assignments': isAdmin() ? 'Assignments' : 'My Jobs',
        'chat': 'Messages',
        'payments': 'Payments',
        'reports': 'Reports'
    };
    document.getElementById('pageTitle').textContent = titles[page] || 'Dashboard';
    
    // Stop chat polling when leaving chat page
    if (page !== 'chat') {
        stopChatPolling();
        currentChatType = null;
        currentChatTarget = null;
    }
    
    // Load specific content
    if (page === 'job-board' && !isAdmin()) loadJobBoard();
    if (page === 'chat') loadChatThreads();
    
    // Close sidebar on mobile
    document.querySelector('.sidebar').classList.remove('active');
    document.getElementById('sidebarOverlay').classList.remove('active');
}

// ========================================
// Dashboard
// ========================================
async function loadDashboard() {
    try {
        const stats = await api('/dashboard/stats');
        
        if (isAdmin()) {
            document.getElementById('totalWriters').textContent = stats.total_writers;
            document.getElementById('activeAssignments').textContent = stats.active_assignments;
            document.getElementById('pendingPayments').textContent = formatCurrency(stats.pending_payments);
            document.getElementById('completedThisMonth').textContent = stats.completed_this_month;
        } else {
            document.getElementById('writerActiveAssignments').textContent = stats.active_assignments;
            document.getElementById('writerCompletedAssignments').textContent = stats.completed_assignments;
            document.getElementById('writerTotalEarned').textContent = formatCurrency(stats.total_earned);
            
            // Load job board count
            try {
                const jobs = await api('/assignments/job-board');
                document.getElementById('writerAvailableJobs').textContent = jobs.length;
                updateJobBoardBadge(jobs.length);
            } catch (e) { /* ignore */ }
        }

        const recentAssignments = await api('/dashboard/recent-assignments');
        renderRecentAssignments(recentAssignments);

        if (isAdmin()) {
            const topWriters = await api('/dashboard/top-writers');
            renderTopWriters(topWriters);
        }
    } catch (error) {
        console.error('Dashboard error:', error);
    }
}

function renderRecentAssignments(list) {
    const container = document.getElementById('recentAssignmentsList');
    
    if (!list.length) {
        container.innerHTML = '<div class="empty-state"><p>No assignments yet</p></div>';
        return;
    }

    container.innerHTML = list.map(a => `
        <div class="assignment-item" onclick="viewAssignment(${a.id})">
            <div class="assignment-info">
                <div class="assignment-title">${a.title}</div>
                <div class="assignment-meta">
                    ${isAdmin() ? (a.writer_name || 'Unassigned') + ' • ' : ''}
                    ${a.word_count.toLocaleString()} words • Due ${formatDate(a.deadline)}
                </div>
            </div>
            <span class="status-badge ${a.status}">${a.status.replace('_', ' ')}</span>
        </div>
    `).join('');
}

function renderTopWriters(list) {
    const container = document.getElementById('topWritersList');
    
    if (!list.length) {
        container.innerHTML = '<div class="empty-state"><p>No data yet</p></div>';
        return;
    }

    container.innerHTML = list.map(w => `
        <div class="writer-item">
            <div class="writer-avatar">${getInitials(w.name)}</div>
            <div class="writer-info">
                <div class="writer-name">${w.name}</div>
                <div class="writer-stats">${w.completed_count} completed</div>
            </div>
            <span class="writer-earnings">${formatCurrency(w.total_earned)}</span>
        </div>
    `).join('');
}

// ========================================
// Job Board (Writers)
// ========================================
async function loadJobBoard() {
    try {
        jobBoard = await api('/assignments/job-board');
        renderJobBoard();
        updateJobBoardBadge(jobBoard.length);
    } catch (error) {
        console.error('Load job board error:', error);
    }
}

function updateJobBoardBadge(count) {
    const badge = document.getElementById('jobBoardBadge');
    if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

function renderJobBoard() {
    const container = document.getElementById('jobBoardList');
    
    if (!jobBoard.length) {
        container.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><p>No jobs available at the moment. Check back later!</p></div>';
        return;
    }

    container.innerHTML = jobBoard.map(job => {
        const deadlineClass = getDeadlineClass(job.deadline);
        const hasInstructions = parseInt(job.has_instructions) > 0;
        
        // Format word count (range or single)
        const wordCountDisplay = job.word_count_min && job.word_count_max && job.word_count_min !== job.word_count_max
            ? `${job.word_count_min.toLocaleString()} - ${job.word_count_max.toLocaleString()}`
            : (job.word_count_max || job.word_count || 0).toLocaleString();
        
        return `
            <div class="job-card">
                <div class="job-card-header">
                    <div>
                        <div class="job-card-title">${job.title}</div>
                        ${job.domain ? `<span class="job-card-domain">${job.domain}</span>` : ''}
                    </div>
                    <div class="job-card-amount">${formatCurrency(job.amount)}</div>
                </div>
                <div class="job-card-details">
                    <div class="job-detail">
                        <span class="job-detail-label">Word Count</span>
                        <span class="job-detail-value">${wordCountDisplay}</span>
                    </div>
                    <div class="job-detail">
                        <span class="job-detail-label">Client Deadline</span>
                        <span class="job-detail-value ${deadlineClass}">${formatDateTime(job.deadline)}</span>
                    </div>
                    <div class="job-detail">
                        <span class="job-detail-label">Instructions</span>
                        <span class="job-detail-value">${hasInstructions ? '<i class="fas fa-paperclip"></i> Attached' : 'In description'}</span>
                    </div>
                </div>
                ${job.description ? `<div class="job-card-description">${job.description}</div>` : ''}
                <div class="job-card-footer">
                    <button class="btn btn-secondary" onclick="viewJobDetails(${job.id})">
                        <i class="fas fa-eye"></i> View Details
                    </button>
                    <button class="btn btn-primary" onclick="openPickJobModal(${job.id})">
                        <i class="fas fa-hand-pointer"></i> Pick Job
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function viewJobDetails(id) {
    const job = jobBoard.find(j => j.id === id);
    if (!job) return;
    viewAssignment(id);
}

function openPickJobModal(id) {
    const job = jobBoard.find(j => j.id === id);
    if (!job) return;
    
    document.getElementById('pickJobId').value = id;
    
    const deadline = new Date(job.deadline);
    const maxWriterDeadline = new Date(deadline.getTime() - 30 * 60 * 1000);
    
    document.getElementById('pickJobSummary').innerHTML = `
        <div class="job-summary-title">${job.title}</div>
        <div class="job-summary-details">
            <span>Word Count:</span> <strong>${job.word_count.toLocaleString()}</strong>
            <span>Amount:</span> <strong>${formatCurrency(job.amount)}</strong>
            <span>Client Deadline:</span> <strong>${formatDateTime(job.deadline)}</strong>
            <span>Your Max Deadline:</span> <strong>${formatDateTime(maxWriterDeadline)}</strong>
        </div>
    `;
    
    // Set default writer deadline to 1 hour before max
    const defaultDeadline = new Date(maxWriterDeadline.getTime() - 60 * 60 * 1000);
    document.getElementById('writerDeadline').value = defaultDeadline.toISOString().slice(0, 16);
    document.getElementById('writerDeadline').max = maxWriterDeadline.toISOString().slice(0, 16);
    
    openModal('pickJobModal');
}

async function pickJob(e) {
    e.preventDefault();
    
    const id = document.getElementById('pickJobId').value;
    const writerDeadline = document.getElementById('writerDeadline').value;
    
    try {
        await api(`/assignments/${id}/pick`, {
            method: 'POST',
            body: { writer_deadline: writerDeadline }
        });
        
        closeModal('pickJobModal');
        showToast('success', 'Job Picked!', 'You have successfully picked this job');
        loadJobBoard();
        loadAssignments();
        loadDashboard();
        navigateTo('assignments');
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

// ========================================
// Writers (Admin)
// ========================================
async function loadWriters() {
    try {
        writers = await api('/writers');
        renderWritersTable();
        populateDropdowns();
    } catch (error) {
        console.error('Load writers error:', error);
    }
}

function renderWritersTable() {
    const tbody = document.getElementById('writersTableBody');
    
    if (!writers.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No writers yet. Add your first writer!</td></tr>';
        return;
    }

    tbody.innerHTML = writers.map(w => {
        const domainsHtml = w.domains ? w.domains.split(',').map(d => 
            `<span class="domain-badge">${d.trim()}</span>`
        ).join(' ') : '<span class="text-muted">-</span>';
        
        return `
            <tr>
                <td>
                    <div class="writer-cell">
                        <div class="writer-avatar">${getInitials(w.name)}</div>
                        <span>${w.name}</span>
                    </div>
                </td>
                <td>${w.email}</td>
                <td>${domainsHtml}</td>
                <td>${formatCurrency(w.rate_per_word)}</td>
                <td>${w.assignment_count || 0}</td>
                <td><strong>${formatCurrency(w.total_owed)}</strong></td>
                <td><span class="status-badge ${w.status}">${w.status}</span></td>
                <td>
                    <div class="actions">
                        <button class="action-btn edit" onclick="editWriter(${w.id})" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="action-btn pay" onclick="resetWriterPassword(${w.id})" title="Reset Password">
                            <i class="fas fa-key"></i>
                        </button>
                        <button class="action-btn delete" onclick="deleteWriter(${w.id}, '${w.name}')" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function populateDropdowns() {
    const activeWriters = writers.filter(w => w.status === 'active');
    const paymentOptions = '<option value="">Select Writer</option>' + 
        activeWriters.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
    
    document.getElementById('paymentWriter').innerHTML = paymentOptions;
    
    // Extract domains
    const domainSet = new Set();
    writers.forEach(w => {
        if (w.domains) {
            w.domains.split(',').forEach(d => domainSet.add(d.trim()));
        }
    });
    allDomains = Array.from(domainSet).sort();
    
    const domainSelect = document.getElementById('assignmentDomain');
    domainSelect.innerHTML = '<option value="">General (all writers notified)</option>' + 
        allDomains.map(d => `<option value="${d}">${d}</option>`).join('');
}

async function saveWriter(e) {
    e.preventDefault();
    
    const id = document.getElementById('writerId').value;
    const data = {
        name: document.getElementById('writerName').value,
        email: document.getElementById('writerEmail').value,
        phone: document.getElementById('writerPhone').value,
        rate_per_word: parseFloat(document.getElementById('writerRate').value),
        domains: document.getElementById('writerDomains').value,
        status: document.getElementById('writerStatusSelect').value,
        notes: document.getElementById('writerNotes').value
    };

    try {
        if (id) {
            await api(`/writers/${id}`, { method: 'PUT', body: data });
            showToast('success', 'Updated', 'Writer updated successfully');
            closeModal('writerModal');
        } else {
            const result = await api('/writers', { method: 'POST', body: data });
            closeModal('writerModal');
            
            if (result.generated_password) {
                document.getElementById('credentialEmail').textContent = result.email;
                document.getElementById('credentialPassword').textContent = result.generated_password;
                openModal('credentialsModal');
            }
            showToast('success', 'Created', 'Writer created. Share credentials with them.');
        }
        
        loadWriters();
        loadDashboard();
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

async function resetWriterPassword(id) {
    try {
        const result = await api(`/writers/${id}/reset-password`, { method: 'POST' });
        document.getElementById('credentialEmail').textContent = result.email;
        document.getElementById('credentialPassword').textContent = result.new_password;
        openModal('credentialsModal');
        showToast('success', 'Password Reset', `New password generated for ${result.name}`);
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

function editWriter(id) {
    const writer = writers.find(w => w.id === id);
    if (!writer) return;

    document.getElementById('writerModalTitle').textContent = 'Edit Writer';
    document.getElementById('writerId').value = writer.id;
    document.getElementById('writerName').value = writer.name;
    document.getElementById('writerEmail').value = writer.email;
    document.getElementById('writerEmail').disabled = true;
    document.getElementById('writerPhone').value = writer.phone || '';
    document.getElementById('writerRate').value = writer.rate_per_word;
    document.getElementById('writerDomains').value = writer.domains || '';
    document.getElementById('writerStatusSelect').value = writer.status;
    document.getElementById('writerNotes').value = writer.notes || '';

    openModal('writerModal');
}

function deleteWriter(id, name) {
    document.getElementById('confirmMessage').textContent = `Delete writer "${name}"?`;
    document.getElementById('confirmActionBtn').onclick = async () => {
        try {
            await api(`/writers/${id}`, { method: 'DELETE' });
            showToast('success', 'Deleted', 'Writer removed');
            closeModal('confirmModal');
            loadWriters();
            loadDashboard();
        } catch (error) {
            showToast('error', 'Error', error.message);
        }
    };
    openModal('confirmModal');
}

// ========================================
// Assignments
// ========================================
async function loadAssignments() {
    try {
        assignments = await api('/assignments');
        renderAssignmentsTable();
    } catch (error) {
        console.error('Load assignments error:', error);
    }
}

function renderAssignmentsTable() {
    const tbody = document.getElementById('assignmentsTableBody');
    const statusFilter = document.getElementById('assignmentStatusFilter').value;
    
    let filtered = assignments;
    if (statusFilter !== 'all') {
        filtered = assignments.filter(a => a.status === statusFilter);
    }

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-state">No jobs found</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(a => {
        const isOverdue = new Date(a.deadline) < new Date() && a.status !== 'completed';
        const writerDeadlineOverdue = a.writer_deadline && new Date(a.writer_deadline) < new Date() && a.status !== 'completed';
        const hasSubmittedAmount = a.submitted_amount && !a.amount_approved;
        const hasExtensionRequest = a.extension_requested;
        const needsRevision = a.revision_requested;
        
        let amountHtml = `<strong>${formatCurrency(a.amount)}</strong>`;
        if (hasSubmittedAmount && isAdmin()) {
            amountHtml = `
                <div>
                    <strong>${formatCurrency(a.amount)}</strong>
                    <div class="approval-needed" style="margin-top:0.25rem">
                        <i class="fas fa-clock"></i> ${formatCurrency(a.submitted_amount)} pending
                    </div>
                </div>
            `;
        }
        
        let statusBadge = `<span class="status-badge ${a.status}">${a.status.replace('_', ' ')}</span>`;
        if (needsRevision) {
            statusBadge = `<span class="status-badge pending" style="background:var(--warning);color:white;"><i class="fas fa-redo"></i> Needs Revision</span>`;
        }
        if (hasExtensionRequest && isAdmin()) {
            statusBadge += ` <span class="status-badge pending" title="Extension requested"><i class="fas fa-clock"></i></span>`;
        }
        
        const highlightRow = hasSubmittedAmount || hasExtensionRequest || needsRevision;
        
        return `
            <tr ${highlightRow ? 'style="background:var(--accent-orange-bg)"' : ''}>
                <td><strong>${a.title}</strong></td>
                ${isAdmin() ? `<td>
                    ${a.writer_name ? `
                        <span class="writer-online-status">
                            ${a.writer_name}
                            ${a.writer_online ? '<span class="online-dot" title="Online"></span>' : ''}
                        </span>
                    ` : '<span class="text-muted">Unassigned</span>'}
                </td>` : ''}
                <td>${a.domain ? `<span class="domain-badge">${a.domain}</span>` : '-'}</td>
                <td>${a.word_count.toLocaleString()}</td>
                <td class="${isOverdue ? 'deadline-urgent' : ''}">${formatDateTime(a.deadline)}</td>
                ${!isAdmin() ? `<td class="${writerDeadlineOverdue ? 'deadline-urgent' : ''}">${a.writer_deadline ? formatDateTime(a.writer_deadline) : '-'}</td>` : ''}
                <td>${amountHtml}</td>
                <td>${statusBadge}</td>
                <td>
                    <div class="actions">
                        <button class="action-btn edit" onclick="viewAssignment(${a.id})" title="View Details">
                            <i class="fas fa-eye"></i>
                        </button>
                        ${isAdmin() ? `
                            ${hasSubmittedAmount ? `
                                <button class="action-btn pay" onclick="approveAmount(${a.id})" title="Approve Amount">
                                    <i class="fas fa-check"></i>
                                </button>
                            ` : ''}
                            ${a.writer_id ? `
                                <button class="action-btn edit" onclick="openOverrideDeadlineModal(${a.id})" title="Override Deadline">
                                    <i class="fas fa-clock"></i>
                                </button>
                            ` : ''}
                            <button class="action-btn delete" onclick="deleteAssignment(${a.id}, '${a.title}')" title="Delete">
                                <i class="fas fa-trash"></i>
                            </button>
                        ` : `
                            ${a.status !== 'completed' ? `
                                <button class="action-btn edit" onclick="openExtensionModal(${a.id})" title="Request Extension">
                                    <i class="fas fa-clock"></i>
                                </button>
                            ` : ''}
                        `}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function saveAssignment(e) {
    e.preventDefault();
    
    const id = document.getElementById('assignmentId').value;
    const wordCountMin = parseInt(document.getElementById('assignmentWordCountMin').value);
    const wordCountMax = parseInt(document.getElementById('assignmentWordCountMax').value);
    
    if (wordCountMax < wordCountMin) {
        showToast('error', 'Error', 'Maximum word count must be greater than or equal to minimum');
        return;
    }
    
    const data = {
        title: document.getElementById('assignmentTitle').value,
        description: document.getElementById('assignmentDescription').value,
        word_count_min: wordCountMin,
        word_count_max: wordCountMax,
        word_count: wordCountMax, // Keep for backwards compatibility
        amount: parseFloat(document.getElementById('assignmentAmount').value),
        deadline: document.getElementById('assignmentDeadline').value,
        domain: document.getElementById('assignmentDomain').value,
        links: document.getElementById('assignmentLinks').value
    };

    try {
        if (id) {
            await api(`/assignments/${id}`, { method: 'PUT', body: data });
            showToast('success', 'Updated', 'Assignment updated successfully');
        } else {
            await api('/assignments', { method: 'POST', body: data });
            showToast('success', 'Posted', 'Job posted to the job board');
        }
        
        closeModal('assignmentModal');
        loadAssignments();
        loadDashboard();
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

async function viewAssignment(id) {
    try {
        const assignment = await api(`/assignments/${id}`);
        const files = await api(`/files/${id}`);
        
        currentChatAssignment = id;
        
        // Format word count (range or single)
        const wordCountDisplay = assignment.word_count_min && assignment.word_count_max && assignment.word_count_min !== assignment.word_count_max
            ? `${assignment.word_count_min.toLocaleString()} - ${assignment.word_count_max.toLocaleString()}`
            : (assignment.word_count_max || assignment.word_count || 0).toLocaleString();
        
        // Format links
        const linksHtml = assignment.links ? assignment.links.split('\n').filter(l => l.trim()).map(link => 
            `<a href="${link.trim()}" target="_blank" rel="noopener" style="display:block;color:var(--primary);word-break:break-all;">${link.trim()}</a>`
        ).join('') : '';
        
        // Revision alert
        const revisionHtml = assignment.revision_requested ? `
            <div class="revision-alert">
                <div class="revision-alert-header">
                    <i class="fas fa-exclamation-triangle"></i>
                    <strong>Revision Requested</strong>
                    ${assignment.revision_count > 1 ? `<span class="revision-count">(Revision #${assignment.revision_count})</span>` : ''}
                </div>
                <div class="revision-reason">${assignment.revision_reason}</div>
                ${!isAdmin() ? `<button class="btn btn-primary btn-sm" onclick="resubmitWork(${assignment.id})" style="margin-top:0.75rem;">
                    <i class="fas fa-paper-plane"></i> Resubmit Work
                </button>` : ''}
            </div>
        ` : '';
        
        let infoHtml = `
            ${revisionHtml}
            <div style="margin-bottom:1rem;">
                <strong style="font-size:1.125rem;">${assignment.title}</strong>
                ${assignment.domain ? `<span class="domain-badge" style="margin-left:0.5rem;">${assignment.domain}</span>` : ''}
            </div>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.75rem;margin-bottom:1rem;">
                <div><span style="color:var(--text-muted);font-size:0.75rem;">Word Count</span><br><strong>${wordCountDisplay}</strong></div>
                <div><span style="color:var(--text-muted);font-size:0.75rem;">Amount</span><br><strong>${formatCurrency(assignment.amount)}</strong></div>
                <div><span style="color:var(--text-muted);font-size:0.75rem;">Client Deadline</span><br><strong class="${getDeadlineClass(assignment.deadline)}">${formatDateTime(assignment.deadline)}</strong></div>
                <div><span style="color:var(--text-muted);font-size:0.75rem;">Status</span><br><span class="status-badge ${assignment.status}">${assignment.status.replace('_', ' ')}</span></div>
                ${assignment.writer_deadline ? `<div><span style="color:var(--text-muted);font-size:0.75rem;">My Deadline</span><br><strong class="${getDeadlineClass(assignment.writer_deadline)}">${formatDateTime(assignment.writer_deadline)}</strong></div>` : ''}
                ${assignment.writer_name ? `<div><span style="color:var(--text-muted);font-size:0.75rem;">Writer</span><br><strong>${assignment.writer_name}</strong></div>` : ''}
            </div>
            ${linksHtml ? `<div style="margin-bottom:1rem;"><span style="color:var(--text-muted);font-size:0.75rem;">Reference Links</span><div style="margin-top:0.25rem;">${linksHtml}</div></div>` : ''}
            ${assignment.description ? `<div style="margin-bottom:1rem;"><span style="color:var(--text-muted);font-size:0.75rem;">Description</span><p style="margin-top:0.25rem;">${assignment.description}</p></div>` : ''}
        `;
        
        // Add submission links section for admin
        const submissionLinksHtml = assignment.submission_links ? assignment.submission_links.split('\n').filter(l => l.trim()).map(link => 
            `<a href="${link.trim()}" target="_blank" rel="noopener" class="submission-link-item">
                <i class="fas fa-external-link-alt"></i> ${link.trim()}
            </a>`
        ).join('') : '';
        
        if (submissionLinksHtml || assignment.submission_notes) {
            infoHtml += `
                <div class="submission-links-section">
                    <div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;margin-bottom:0.5rem;">
                        <i class="fas fa-link"></i> Submitted Work Links
                    </div>
                    ${submissionLinksHtml ? `<div class="submission-links-list">${submissionLinksHtml}</div>` : ''}
                    ${assignment.submission_notes ? `<div class="submission-notes"><strong>Notes:</strong> ${assignment.submission_notes}</div>` : ''}
                    ${assignment.submitted_at ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.5rem;">Submitted ${formatTimeAgo(assignment.submitted_at)}</div>` : ''}
                </div>
            `;
        }
        
        document.getElementById('assignmentDetailsTitle').textContent = assignment.title;
        document.getElementById('assignmentDetailsInfo').innerHTML = infoHtml;
        
        // Render files
        const instructions = files.filter(f => f.upload_type === 'instructions');
        const submissions = files.filter(f => f.upload_type === 'submission');
        
        let filesHtml = '';
        if (instructions.length) {
            filesHtml += '<div style="margin-bottom:0.75rem;font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;">Instructions</div>';
            filesHtml += instructions.map(f => renderFileItem(f)).join('');
        }
        if (submissions.length) {
            filesHtml += '<div style="margin:0.75rem 0;font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;">Submissions</div>';
            filesHtml += submissions.map(f => renderFileItem(f)).join('');
        }
        if (!files.length) {
            filesHtml = '<div class="empty-state"><p>No files uploaded yet</p></div>';
        }
        document.getElementById('assignmentFiles').innerHTML = filesHtml;
        
        // Load chat messages
        loadMiniChat(id);
        
        // Show/hide mark completed button
        const markCompletedBtn = document.getElementById('markCompletedBtn');
        if (!isAdmin() && assignment.status !== 'completed' && !assignment.revision_requested) {
            markCompletedBtn.style.display = 'inline-flex';
            markCompletedBtn.onclick = () => markAssignmentCompleted(id);
        } else {
            markCompletedBtn.style.display = 'none';
        }
        
        // Show/hide request revision button for admin
        const requestRevisionBtn = document.getElementById('requestRevisionBtn');
        if (isAdmin() && assignment.writer_id && assignment.status === 'completed') {
            requestRevisionBtn.style.display = 'inline-flex';
            requestRevisionBtn.onclick = () => openRevisionModal(id, assignment.title);
        } else if (requestRevisionBtn) {
            requestRevisionBtn.style.display = 'none';
        }
        
        openModal('assignmentDetailsModal');
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

function renderFileItem(file) {
    const icon = file.file_type.includes('pdf') ? 'fa-file-pdf' : 
                 file.file_type.includes('word') ? 'fa-file-word' : 
                 file.file_type.includes('image') ? 'fa-file-image' : 'fa-file';
    
    return `
        <div class="file-item">
            <div class="file-icon"><i class="fas ${icon}"></i></div>
            <div class="file-info">
                <div class="file-name">${file.original_name}</div>
                <div class="file-meta">${file.uploader_name} • ${formatTimeAgo(file.created_at)}</div>
            </div>
            <div class="file-actions">
                <button onclick="downloadFile(${file.id})" title="Download"><i class="fas fa-download"></i></button>
            </div>
        </div>
    `;
}

async function downloadFile(fileId) {
    const token = localStorage.getItem('token');
    window.open(`${API_URL}/files/download/${fileId}?token=${token}`, '_blank');
}

// Open submission modal instead of direct marking
function markAssignmentCompleted(id) {
    const assignment = assignments.find(a => a.id === id);
    if (!assignment) return;
    
    document.getElementById('submitWorkAssignmentId').value = id;
    document.getElementById('submitWorkTitle').textContent = assignment.title;
    document.getElementById('submitWorkLinks').value = assignment.submission_links || '';
    document.getElementById('submitWorkNotes').value = assignment.submission_notes || '';
    document.getElementById('submitWorkFile').value = '';
    
    closeModal('assignmentDetailsModal');
    openModal('submitWorkModal');
}

async function submitWork(e) {
    e.preventDefault();
    
    const id = document.getElementById('submitWorkAssignmentId').value;
    const links = document.getElementById('submitWorkLinks').value.trim();
    const notes = document.getElementById('submitWorkNotes').value.trim();
    const fileInput = document.getElementById('submitWorkFile');
    
    if (!links && !fileInput.files.length) {
        showToast('error', 'Error', 'Please provide at least a link or file');
        return;
    }
    
    try {
        // Upload file if provided
        if (fileInput.files.length > 0) {
            const formData = new FormData();
            formData.append('file', fileInput.files[0]);
            formData.append('upload_type', 'submission');
            
            const token = localStorage.getItem('token');
            const uploadRes = await fetch(`${API_URL}/files/${id}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            
            if (!uploadRes.ok) {
                const err = await uploadRes.json();
                throw new Error(err.error || 'File upload failed');
            }
        }
        
        // Submit links if provided
        if (links) {
            await api(`/files/${id}/submit-links`, { 
                method: 'POST', 
                body: { links, notes } 
            });
        }
        
        // Mark as completed
        await api(`/assignments/${id}`, { 
            method: 'PUT', 
            body: { status: 'completed' } 
        });
        
        showToast('success', 'Submitted', 'Work submitted successfully! Admin has been notified.');
        closeModal('submitWorkModal');
        loadAssignments();
        loadDashboard();
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

async function approveAmount(id) {
    try {
        await api(`/assignments/${id}`, { method: 'PUT', body: { amount_approved: true } });
        showToast('success', 'Approved', 'Amount approved successfully');
        loadAssignments();
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

// ========================================
// Revision Workflow
// ========================================
function openRevisionModal(id, title) {
    document.getElementById('revisionAssignmentId').value = id;
    document.getElementById('revisionAssignmentTitle').textContent = title;
    document.getElementById('revisionReason').value = '';
    openModal('revisionModal');
}

async function submitRevisionRequest(e) {
    e.preventDefault();
    
    const id = document.getElementById('revisionAssignmentId').value;
    const reason = document.getElementById('revisionReason').value.trim();
    
    if (!reason) {
        showToast('error', 'Error', 'Please provide a revision reason');
        return;
    }
    
    try {
        await api(`/assignments/${id}/request-revision`, { 
            method: 'POST', 
            body: { reason } 
        });
        showToast('success', 'Sent', 'Revision request sent to writer');
        closeModal('revisionModal');
        closeModal('assignmentDetailsModal');
        loadAssignments();
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

async function resubmitWork(id) {
    try {
        await api(`/assignments/${id}/clear-revision`, { method: 'POST' });
        showToast('success', 'Resubmitted', 'Work resubmitted for review');
        closeModal('assignmentDetailsModal');
        loadAssignments();
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

function deleteAssignment(id, title) {
    document.getElementById('confirmMessage').textContent = `Delete assignment "${title}"?`;
    document.getElementById('confirmActionBtn').onclick = async () => {
        try {
            await api(`/assignments/${id}`, { method: 'DELETE' });
            showToast('success', 'Deleted', 'Assignment deleted');
            closeModal('confirmModal');
            loadAssignments();
            loadDashboard();
        } catch (error) {
            showToast('error', 'Error', error.message);
        }
    };
    openModal('confirmModal');
}

// ========================================
// Extension Requests
// ========================================
function openExtensionModal(id) {
    const assignment = assignments.find(a => a.id === id);
    if (!assignment) return;
    
    document.getElementById('extensionAssignmentId').value = id;
    
    const deadline = new Date(assignment.deadline);
    const maxDeadline = new Date(deadline.getTime() - 30 * 60 * 1000);
    document.getElementById('newDeadline').max = maxDeadline.toISOString().slice(0, 16);
    document.getElementById('newDeadline').value = '';
    document.getElementById('extensionReason').value = '';
    
    openModal('extensionModal');
}

async function submitExtensionRequest(e) {
    e.preventDefault();
    
    const id = document.getElementById('extensionAssignmentId').value;
    const requested_deadline = document.getElementById('newDeadline').value;
    const reason = document.getElementById('extensionReason').value;
    
    try {
        await api(`/assignments/${id}/extension`, {
            method: 'POST',
            body: { requested_deadline, reason }
        });
        
        closeModal('extensionModal');
        showToast('success', 'Submitted', 'Extension request submitted');
        loadAssignments();
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

async function loadExtensionRequests() {
    try {
        const requests = await api('/assignments/extensions/pending');
        const section = document.getElementById('extensionRequestsSection');
        const list = document.getElementById('extensionRequestsList');
        
        if (requests.length) {
            section.style.display = 'block';
            list.innerHTML = requests.map(r => `
                <div class="extension-card">
                    <div class="extension-info">
                        <div class="extension-title">${r.assignment_title}</div>
                        <div class="extension-meta">
                            ${r.writer_name} • Wants: ${formatDateTime(r.requested_deadline)}<br>
                            Reason: ${r.reason}
                        </div>
                    </div>
                    <div class="extension-actions">
                        <button class="btn btn-success btn-sm" onclick="respondToExtension(${r.id}, 'approved')">
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="respondToExtension(${r.id}, 'rejected')">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
            `).join('');
        } else {
            section.style.display = 'none';
        }
    } catch (error) {
        console.error('Load extension requests error:', error);
    }
}

async function respondToExtension(id, status) {
    try {
        await api(`/assignments/extension/${id}/respond`, {
            method: 'POST',
            body: { status, admin_response: '' }
        });
        
        showToast('success', status === 'approved' ? 'Approved' : 'Rejected', `Extension request ${status}`);
        loadExtensionRequests();
        loadAssignments();
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

function openOverrideDeadlineModal(id) {
    const assignment = assignments.find(a => a.id === id);
    if (!assignment) return;
    
    document.getElementById('overrideAssignmentId').value = id;
    document.getElementById('overrideDeadline').value = assignment.writer_deadline ? 
        new Date(assignment.writer_deadline).toISOString().slice(0, 16) : '';
    
    openModal('overrideDeadlineModal');
}

async function overrideDeadline(e) {
    e.preventDefault();
    
    const id = document.getElementById('overrideAssignmentId').value;
    const new_deadline = document.getElementById('overrideDeadline').value;
    
    try {
        await api(`/assignments/${id}/override-deadline`, {
            method: 'POST',
            body: { new_deadline }
        });
        
        closeModal('overrideDeadlineModal');
        showToast('success', 'Updated', 'Writer deadline updated');
        loadAssignments();
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

async function checkOverdueJobs() {
    try {
        const result = await api('/assignments/check-overdue', { method: 'POST' });
        if (result.reopened_count > 0) {
            showToast('warning', 'Jobs Reopened', `${result.reopened_count} overdue job(s) have been reopened`);
        } else {
            showToast('success', 'All Good', 'No overdue jobs found');
        }
        loadAssignments();
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

// ========================================
// Chat / Messages
// ========================================
let currentChatType = null; // 'assignment' or 'direct'
let currentChatTarget = null; // assignmentId or userId

async function loadChatThreads() {
    try {
        const data = await api('/messages/threads');
        
        if (isAdmin()) {
            // Admin gets array of assignment threads
            chatThreads = Array.isArray(data) ? data : [];
            renderChatThreads();
        } else {
            // Writer gets { admins: [], assignments: [] }
            renderWriterChatThreads(data);
        }
    } catch (error) {
        console.error('Load chat threads error:', error);
    }
}

function renderChatThreads() {
    const container = document.getElementById('chatThreads');
    
    if (!chatThreads.length) {
        container.innerHTML = '<div class="empty-state"><p>No conversations yet</p></div>';
        return;
    }

    container.innerHTML = chatThreads.map(t => `
        <div class="chat-thread ${currentChatType === 'assignment' && currentChatTarget === t.assignment_id ? 'active' : ''}" onclick="openAssignmentChat(${t.assignment_id})">
            <div class="chat-thread-avatar">
                ${getInitials(t.writer_name || 'Writer')}
                <span class="online-dot ${t.writer_online ? '' : 'offline'}"></span>
            </div>
            <div class="chat-thread-info">
                <div class="chat-thread-name">${t.writer_name || 'Writer'}</div>
                <div class="chat-thread-title">${t.title}</div>
            </div>
            ${t.unread_count > 0 ? `<span class="chat-thread-badge">${t.unread_count}</span>` : ''}
        </div>
    `).join('');
}

function renderWriterChatThreads(data) {
    const container = document.getElementById('chatThreads');
    const admins = data.admins || [];
    const assignmentThreads = data.assignments || [];
    
    let html = '';
    
    // Show admins first
    if (admins.length > 0) {
        html += '<div class="chat-section-title" style="padding:0.5rem 1rem;font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;">Admins</div>';
        html += admins.map(a => `
            <div class="chat-thread ${currentChatType === 'direct' && currentChatTarget === a.user_id ? 'active' : ''}" onclick="openDirectChat(${a.user_id}, '${a.name.replace(/'/g, "\\'")}')">
                <div class="chat-thread-avatar">
                    ${getInitials(a.name)}
                    <span class="online-dot ${a.is_online ? '' : 'offline'}"></span>
                </div>
                <div class="chat-thread-info">
                    <div class="chat-thread-name">${a.name}</div>
                    <div class="chat-thread-title">${a.is_online ? 'Online' : (a.last_seen ? 'Last seen ' + formatTimeAgo(a.last_seen) : 'Offline')}</div>
                </div>
            </div>
        `).join('');
    }
    
    // Show assignment threads
    if (assignmentThreads.length > 0) {
        html += '<div class="chat-section-title" style="padding:0.5rem 1rem;font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;margin-top:0.5rem;">Job Conversations</div>';
        html += assignmentThreads.map(t => `
            <div class="chat-thread ${currentChatType === 'assignment' && currentChatTarget === t.assignment_id ? 'active' : ''}" onclick="openAssignmentChat(${t.assignment_id})">
                <div class="chat-thread-avatar">
                    <i class="fas fa-file-alt" style="font-size:0.875rem;"></i>
                </div>
                <div class="chat-thread-info">
                    <div class="chat-thread-name">${t.title}</div>
                    <div class="chat-thread-title">Job discussion</div>
                </div>
                ${t.unread_count > 0 ? `<span class="chat-thread-badge">${t.unread_count}</span>` : ''}
            </div>
        `).join('');
    }
    
    if (!admins.length && !assignmentThreads.length) {
        html = '<div class="empty-state"><p>No conversations available</p></div>';
    }
    
    container.innerHTML = html;
}

async function openDirectChat(userId, userName) {
    currentChatType = 'direct';
    currentChatTarget = userId;
    currentChatAssignment = null;
    
    // Re-render threads to show active state
    loadChatThreads();
    
    try {
        const messages = await api(`/messages/direct/${userId}`);
        
        // Update header
        const header = document.getElementById('chatWindowHeader');
        header.innerHTML = `
            <div class="chat-user-info">
                <span class="chat-user-name">${userName}</span>
                <span class="chat-user-status" id="directChatStatus">Loading...</span>
            </div>
        `;
        
        // Get online status
        try {
            const status = await api(`/messages/status/${userId}`);
            document.getElementById('directChatStatus').innerHTML = status.is_online 
                ? '<span class="online">Online</span>' 
                : `Last seen ${formatTimeAgo(status.last_seen)}`;
        } catch (e) {}
        
        renderChatMessages(messages);
        document.getElementById('chatInputArea').style.display = 'flex';
        
        // Auto-scroll
        const messagesContainer = document.getElementById('chatMessages');
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Start real-time polling for this chat
        startChatPolling();
    } catch (error) {
        console.error('Open direct chat error:', error);
    }
}

async function openAssignmentChat(assignmentId) {
    currentChatType = 'assignment';
    currentChatTarget = assignmentId;
    currentChatAssignment = assignmentId;
    
    // Re-render threads
    loadChatThreads();
    
    try {
        const messages = await api(`/messages/assignment/${assignmentId}`);
        const assignment = assignments.find(a => a.id === assignmentId);
        
        // Update header
        const header = document.getElementById('chatWindowHeader');
        header.innerHTML = `
            <div class="chat-user-info">
                <span class="chat-user-name">${assignment?.title || 'Assignment Chat'}</span>
                <span class="chat-user-status">${isAdmin() && assignment?.writer_name ? 'With ' + assignment.writer_name : ''}</span>
            </div>
        `;
        
        renderChatMessages(messages);
        document.getElementById('chatInputArea').style.display = 'flex';
        
        // Auto-scroll
        const messagesContainer = document.getElementById('chatMessages');
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Start real-time polling for this chat
        startChatPolling();
    } catch (error) {
        console.error('Open assignment chat error:', error);
    }
}

// Keep old function for backward compatibility
async function openChat(assignmentId) {
    openAssignmentChat(assignmentId);
}

// Format date for chat grouping (uses parseDbDate from utilities)
function formatChatDate(dateString) {
    const date = parseDbDate(dateString);
    if (!date) return '';
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Compare dates in local timezone
    const dateLocal = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const yesterdayLocal = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
    
    if (dateLocal.getTime() === todayLocal.getTime()) {
        return 'Today';
    } else if (dateLocal.getTime() === yesterdayLocal.getTime()) {
        return 'Yesterday';
    } else {
        return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
    }
}

// Format time for messages - shows in user's local timezone
function formatChatTime(dateString) {
    const date = parseDbDate(dateString);
    if (!date) return '';
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true });
}

// Render file attachment in message
function renderFileAttachment(msg) {
    if (!msg.file_url) return '';
    
    const isImage = msg.file_type && msg.file_type.startsWith('image/');
    const isPdf = msg.file_type === 'application/pdf';
    const isDoc = msg.file_type && (msg.file_type.includes('word') || msg.file_type.includes('document'));
    
    let icon = 'fa-file';
    if (isPdf) icon = 'fa-file-pdf';
    else if (isDoc) icon = 'fa-file-word';
    else if (isImage) icon = 'fa-image';
    
    if (isImage) {
        return `
            <div class="chat-file-attachment image-attachment">
                <a href="${msg.file_url}" target="_blank" class="chat-image-link">
                    <img src="${msg.file_url}" alt="${msg.file_name}" class="chat-image-preview">
                </a>
                <div class="chat-file-name">${msg.file_name}</div>
            </div>
        `;
    }
    
    return `
        <div class="chat-file-attachment">
            <a href="${msg.file_url}" target="_blank" download="${msg.file_name}" class="chat-file-link">
                <div class="chat-file-icon"><i class="fas ${icon}"></i></div>
                <div class="chat-file-details">
                    <span class="chat-file-name">${msg.file_name}</span>
                    <span class="chat-file-action">Click to download</span>
                </div>
            </a>
        </div>
    `;
}

function renderChatMessages(messages) {
    const container = document.getElementById('chatMessages');
    
    if (!messages.length) {
        container.innerHTML = '<div class="empty-state"><p>No messages yet. Start the conversation!</p></div>';
        return;
    }

    // Group messages by date
    const groupedMessages = {};
    messages.forEach(m => {
        const dateKey = new Date(m.created_at).toDateString();
        if (!groupedMessages[dateKey]) {
            groupedMessages[dateKey] = [];
        }
        groupedMessages[dateKey].push(m);
    });
    
    let html = '';
    const myId = parseInt(currentUser.id); // Ensure number comparison
    
    for (const [dateKey, msgs] of Object.entries(groupedMessages)) {
        const dateLabel = formatChatDate(msgs[0].created_at);
        html += `<div class="chat-date-separator"><span>${dateLabel}</span></div>`;
        
        msgs.forEach((m, idx) => {
            const isSent = parseInt(m.sender_id) === myId;
            const showName = !isSent && (idx === 0 || msgs[idx - 1].sender_id !== m.sender_id);
            const hasFile = m.file_url;
            const hasMessage = m.message && m.message.trim();
            
            html += `
                <div class="chat-message ${isSent ? 'sent' : 'received'}">
                    ${showName ? `<div class="chat-sender-name">${m.sender_name}</div>` : ''}
                    ${hasFile ? renderFileAttachment(m) : ''}
                    ${hasMessage ? `<div class="chat-message-text">${m.message}</div>` : ''}
                    <div class="chat-message-footer">
                        <span class="chat-message-time">${formatChatTime(m.created_at)}</span>
                        ${isSent ? `<span class="chat-message-status">${m.read_at ? '<i class="fas fa-check-double"></i>' : '<i class="fas fa-check"></i>'}</span>` : ''}
                    </div>
                </div>
            `;
        });
    }
    
    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
}

// File upload for chat
async function uploadChatFile(file) {
    if (!currentChatType || !currentChatTarget) {
        showToast('error', 'Error', 'No chat selected');
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('message', '');
    
    const token = localStorage.getItem('token');
    const endpoint = currentChatType === 'direct' 
        ? `/api/messages/direct/${currentChatTarget}/file`
        : `/api/messages/assignment/${currentChatTarget}/file`;
    
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Upload failed');
        }
        
        // Refresh chat
        if (currentChatType === 'direct') {
            openDirectChat(currentChatTarget, document.querySelector('.chat-user-name')?.textContent || 'Chat');
        } else {
            openAssignmentChat(currentChatTarget);
        }
        
        showToast('success', 'Uploaded', 'File sent successfully');
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

async function sendMessage() {
    const input = document.getElementById('chatMessageInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    try {
        if (currentChatType === 'direct' && currentChatTarget) {
            await api(`/messages/direct/${currentChatTarget}`, {
                method: 'POST',
                body: { message }
            });
            input.value = '';
            openDirectChat(currentChatTarget, document.querySelector('.chat-user-name')?.textContent || 'Chat');
        } else if (currentChatType === 'assignment' && currentChatTarget) {
            await api(`/messages/assignment/${currentChatTarget}`, {
                method: 'POST',
                body: { message }
            });
            input.value = '';
            openAssignmentChat(currentChatTarget);
        }
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

// Online status polling
let statusPollInterval = null;
let chatPollInterval = null;
let lastMessageCount = 0;

function startStatusPolling() {
    // Update own status to online
    api('/messages/status', { method: 'POST', body: { online: true } }).catch(() => {});
    
    // Poll for status updates every 30 seconds
    if (statusPollInterval) clearInterval(statusPollInterval);
    statusPollInterval = setInterval(async () => {
        // Keep online
        api('/messages/status', { method: 'POST', body: { online: true } }).catch(() => {});
        
        // Refresh threads to get updated online statuses and unread counts
        if (document.getElementById('chat-page')?.classList.contains('active')) {
            loadChatThreads();
        }
    }, 30000);
}

// Poll for new chat messages - runs every 1.5 seconds for real-time feel
function startChatPolling() {
    console.log('🔄 Starting chat polling...');
    if (chatPollInterval) clearInterval(chatPollInterval);
    lastMessageCount = 0;
    
    // Immediate first poll
    pollChatMessages();
    
    chatPollInterval = setInterval(pollChatMessages, 1500); // Poll every 1.5 seconds
}

async function pollChatMessages() {
    if (!currentChatType || !currentChatTarget) return;
    
    try {
        let messages;
        if (currentChatType === 'direct') {
            messages = await api(`/messages/direct/${currentChatTarget}`);
        } else if (currentChatType === 'assignment') {
            messages = await api(`/messages/assignment/${currentChatTarget}`);
        }
        
        if (messages && messages.length !== lastMessageCount) {
            console.log(`📨 Chat updated: ${lastMessageCount} → ${messages.length} messages`);
            lastMessageCount = messages.length;
            
            const container = document.getElementById('chatMessages');
            if (!container) return;
            
            const wasAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 100;
            
            renderChatMessages(messages);
            
            // Auto-scroll if user was at bottom or new messages arrived
            if (wasAtBottom) {
                container.scrollTop = container.scrollHeight;
            }
            
            // Play sound for new messages (if not from current user)
            const lastMsg = messages[messages.length - 1];
            if (lastMsg && parseInt(lastMsg.sender_id) !== parseInt(currentUser.id)) {
                playNotificationSound();
            }
        }
    } catch (e) {
        // Silent fail - don't spam console
    }
}

function stopChatPolling() {
    console.log('⏹️ Stopping chat polling');
    if (chatPollInterval) {
        clearInterval(chatPollInterval);
        chatPollInterval = null;
    }
    lastMessageCount = 0;
}

function stopStatusPolling() {
    // Set offline
    api('/messages/status', { method: 'POST', body: { online: false } }).catch(() => {});
    stopChatPolling();
    
    if (statusPollInterval) {
        clearInterval(statusPollInterval);
        statusPollInterval = null;
    }
}

// Update visibility handling - resume/pause polling when app is foregrounded/backgrounded
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        api('/messages/status', { method: 'POST', body: { online: true } }).catch(() => {});
        
        // Resume chat polling if we're in a chat
        if (currentChatType && currentChatTarget && !chatPollInterval) {
            console.log('📱 App visible - resuming chat polling');
            startChatPolling();
        }
    } else {
        api('/messages/status', { method: 'POST', body: { online: false } }).catch(() => {});
    }
});

// Handle window close
window.addEventListener('beforeunload', () => {
    navigator.sendBeacon('/api/messages/status', JSON.stringify({ online: false }));
});

async function loadMiniChat(assignmentId) {
    try {
        const messages = await api(`/messages/assignment/${assignmentId}`);
        const container = document.getElementById('miniChatMessages');
        const myId = parseInt(currentUser.id);
        
        if (!messages.length) {
            container.innerHTML = '<div class="empty-state" style="padding:1rem;"><p>No messages yet</p></div>';
        } else {
            container.innerHTML = messages.slice(-10).map(m => `
                <div class="chat-message ${parseInt(m.sender_id) === myId ? 'sent' : 'received'}" style="max-width:85%;padding:0.5rem 0.75rem;font-size:0.8125rem;">
                    ${m.message}
                </div>
            `).join('');
            container.scrollTop = container.scrollHeight;
        }
    } catch (error) {
        console.error('Load mini chat error:', error);
    }
}

async function sendMiniChatMessage() {
    const input = document.getElementById('miniChatInput');
    const message = input.value.trim();
    
    if (!message || !currentChatAssignment) return;
    
    try {
        await api(`/messages/assignment/${currentChatAssignment}`, {
            method: 'POST',
            body: { message }
        });
        
        input.value = '';
        loadMiniChat(currentChatAssignment);
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

async function loadUnreadCount() {
    try {
        const result = await api('/messages/unread');
        const badge = document.getElementById('chatBadge');
        if (result.count > 0) {
            badge.textContent = result.count;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    } catch (error) {
        console.error('Load unread count error:', error);
    }
}

// ========================================
// File Uploads
// ========================================
async function handleFileUpload(file, assignmentId, uploadType) {
    try {
        await uploadFile(`/files/${assignmentId}`, file, { upload_type: uploadType });
        showToast('success', 'Uploaded', 'File uploaded successfully');
        viewAssignment(assignmentId);
    } catch (error) {
        showToast('error', 'Upload Failed', error.message);
    }
}

// ========================================
// Payments
// ========================================
async function loadPayments() {
    try {
        if (isAdmin()) {
            paymentSummary = await api('/payments/summary');
            renderPaymentsSummary();
            
            const totals = await api('/payments/totals');
            document.getElementById('totalPaid').textContent = formatCurrency(totals.total_paid);
            document.getElementById('totalPending').textContent = formatCurrency(totals.total_pending);
        }
        
        const history = await api('/payments/history');
        renderPaymentHistory(history);
    } catch (error) {
        console.error('Load payments error:', error);
    }
}

function renderPaymentsSummary() {
    const tbody = document.getElementById('paymentsTableBody');
    
    if (!paymentSummary.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No payment data</td></tr>';
        return;
    }

    tbody.innerHTML = paymentSummary.map(p => `
        <tr>
            <td><strong>${p.writer_name}</strong></td>
            <td>${p.completed_assignments}</td>
            <td>${formatCurrency(p.total_earned)}</td>
            <td>${formatCurrency(p.total_paid)}</td>
            <td><strong style="color:${p.balance_owed > 0 ? 'var(--accent-orange)' : 'var(--accent-green)'}">${formatCurrency(p.balance_owed)}</strong></td>
            <td>
                ${p.balance_owed > 0 ? `
                    <button class="btn btn-sm btn-primary" onclick="openPaymentModal(${p.writer_id}, ${p.balance_owed})">
                        Pay
                    </button>
                ` : ''}
            </td>
        </tr>
    `).join('');
}

function renderPaymentHistory(history) {
    const tbody = document.getElementById('paymentHistoryBody');
    
    if (!history.length) {
        tbody.innerHTML = `<tr><td colspan="${isAdmin() ? 5 : 4}" class="empty-state">No payments yet</td></tr>`;
        return;
    }

    tbody.innerHTML = history.map(p => `
        <tr>
            <td>${formatDate(p.payment_date)}</td>
            ${isAdmin() ? `<td>${p.writer_name}</td>` : ''}
            <td><strong>${formatCurrency(p.amount)}</strong></td>
            <td>${p.method || '-'}</td>
            <td>${p.reference || '-'}</td>
        </tr>
    `).join('');
}

function openPaymentModal(writerId, balance) {
    document.getElementById('paymentWriter').value = writerId;
    document.getElementById('writerBalance').textContent = formatCurrency(balance);
    document.getElementById('paymentAmount').value = balance;
    document.getElementById('paymentDate').value = new Date().toISOString().split('T')[0];
    openModal('paymentModal');
}

async function savePayment(e) {
    e.preventDefault();
    
    const data = {
        writer_id: document.getElementById('paymentWriter').value,
        amount: parseFloat(document.getElementById('paymentAmount').value),
        payment_date: document.getElementById('paymentDate').value,
        method: document.getElementById('paymentMethod').value,
        reference: document.getElementById('paymentReference').value
    };

    try {
        await api('/payments', { method: 'POST', body: data });
        showToast('success', 'Recorded', 'Payment recorded successfully');
        closeModal('paymentModal');
        loadPayments();
        loadDashboard();
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

// ========================================
// Reports
// ========================================
async function generateReport() {
    const startDate = document.getElementById('reportStartDate').value;
    const endDate = document.getElementById('reportEndDate').value;
    
    try {
        const report = await api(`/dashboard/report?start=${startDate}&end=${endDate}`);
        
        document.getElementById('reportTotalAssignments').textContent = report.total_assignments;
        document.getElementById('reportTotalSpent').textContent = formatCurrency(report.total_spent);
        document.getElementById('reportTotalWords').textContent = report.total_words.toLocaleString();
        document.getElementById('reportAvgRate').textContent = formatCurrency(report.avg_rate);
        
        const tbody = document.getElementById('reportTableBody');
        if (!report.writers?.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No data for this period</td></tr>';
        } else {
            tbody.innerHTML = report.writers.map(w => `
                <tr>
                    <td>${w.name}</td>
                    <td>${w.assignments}</td>
                    <td>${w.words.toLocaleString()}</td>
                    <td>${w.completed}</td>
                    <td>${formatCurrency(w.earnings)}</td>
                </tr>
            `).join('');
        }
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

// ========================================
// Notifications
// ========================================
async function loadNotifications() {
    try {
        const prevUnreadCount = notifications.filter(n => !n.read).length;
        notifications = await api('/auth/notifications');
        const newUnreadCount = notifications.filter(n => !n.read).length;
        
        // Play sound if there are new unread notifications
        if (newUnreadCount > prevUnreadCount && prevUnreadCount >= 0) {
            playNotificationSound();
        }
        
        renderNotifications();
        updateNotificationBadge();
    } catch (error) {
        console.error('Load notifications error:', error);
    }
}

function renderNotifications() {
    const container = document.getElementById('notificationsList');
    
    if (!notifications.length) {
        container.innerHTML = '<div class="empty-state"><p>No notifications</p></div>';
        return;
    }

    container.innerHTML = notifications.slice(0, 20).map(n => `
        <div class="notification-item ${n.read ? '' : 'unread'}" onclick="markNotificationRead(${n.id})">
            <div class="notification-icon ${n.type}">
                <i class="fas fa-${n.type === 'error' ? 'exclamation-circle' : n.type === 'success' ? 'check-circle' : n.type === 'warning' ? 'exclamation-triangle' : 'bell'}"></i>
            </div>
            <div class="notification-content">
                <div class="notification-title">${n.title}</div>
                <div class="notification-message">${n.message}</div>
                <div class="notification-time">${formatTimeAgo(n.created_at)}</div>
            </div>
        </div>
    `).join('');
}

function updateNotificationBadge() {
    const unread = notifications.filter(n => !n.read).length;
    const badge = document.getElementById('notificationBadge');
    if (unread > 0) {
        badge.textContent = unread;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

async function markNotificationRead(id) {
    try {
        await api(`/auth/notifications/${id}/read`, { method: 'PUT' });
        const notif = notifications.find(n => n.id === id);
        if (notif) notif.read = true;
        renderNotifications();
        updateNotificationBadge();
    } catch (error) {
        console.error('Mark read error:', error);
    }
}

async function markAllNotificationsRead() {
    try {
        await api('/auth/notifications/read-all', { method: 'PUT' });
        notifications.forEach(n => n.read = true);
        renderNotifications();
        updateNotificationBadge();
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

// ========================================
// Password Change
// ========================================
async function changePassword(e) {
    e.preventDefault();
    
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    
    if (newPassword !== confirmPassword) {
        showToast('error', 'Error', 'Passwords do not match');
        return;
    }
    
    try {
        await api('/auth/change-password', {
            method: 'POST',
            body: { currentPassword, newPassword }
        });
        
        closeModal('passwordModal');
        showToast('success', 'Updated', 'Password changed successfully');
        
        // Update local user state
        currentUser.must_change_password = false;
        localStorage.setItem('user', JSON.stringify(currentUser));
        
        document.getElementById('passwordForm').reset();
    } catch (error) {
        showToast('error', 'Error', error.message);
    }
}

// ========================================
// Modals
// ========================================
function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function openNewWriterModal() {
    document.getElementById('writerModalTitle').textContent = 'Add New Writer';
    document.getElementById('writerForm').reset();
    document.getElementById('writerId').value = '';
    document.getElementById('writerEmail').disabled = false;
    openModal('writerModal');
}

function openNewAssignmentModal() {
    document.getElementById('assignmentModalTitle').textContent = 'Post New Job';
    document.getElementById('assignmentForm').reset();
    document.getElementById('assignmentId').value = '';
    
    // Set default deadline to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('assignmentDeadline').value = tomorrow.toISOString().slice(0, 16);
    
    openModal('assignmentModal');
}

// ========================================
// Event Listeners
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    updateSoundIcon(); // Initialize sound icon state
    
    // Login form
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        try {
            await login(email, password);
        } catch (error) { /* handled in login */ }
    });
    
    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
    
    // Logout
    document.getElementById('logoutBtn').addEventListener('click', logout);
    
    // Navigation
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo(item.dataset.page);
        });
    });
    
    document.querySelectorAll('.view-all[data-page]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo(link.dataset.page);
        });
    });
    
    // Mobile menu
    document.querySelector('.menu-toggle').addEventListener('click', () => {
        document.querySelector('.sidebar').classList.toggle('active');
        document.getElementById('sidebarOverlay').classList.toggle('active');
    });
    
    document.getElementById('sidebarOverlay').addEventListener('click', () => {
        document.querySelector('.sidebar').classList.remove('active');
        document.getElementById('sidebarOverlay').classList.remove('active');
    });
    
    // Modal closes
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });
    
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('active');
        });
    });
    
    // Forms
    document.getElementById('writerForm').addEventListener('submit', saveWriter);
    document.getElementById('assignmentForm').addEventListener('submit', saveAssignment);
    document.getElementById('paymentForm').addEventListener('submit', savePayment);
    document.getElementById('passwordForm').addEventListener('submit', changePassword);
    document.getElementById('pickJobForm').addEventListener('submit', pickJob);
    document.getElementById('extensionForm').addEventListener('submit', submitExtensionRequest);
    document.getElementById('overrideDeadlineForm').addEventListener('submit', overrideDeadline);
    
    // Buttons
    document.getElementById('addWriterBtn')?.addEventListener('click', openNewWriterModal);
    document.getElementById('addAssignmentBtn')?.addEventListener('click', openNewAssignmentModal);
    document.getElementById('recordPaymentBtn')?.addEventListener('click', () => {
        document.getElementById('paymentForm').reset();
        openModal('paymentModal');
    });
    document.getElementById('generateReportBtn')?.addEventListener('click', generateReport);
    document.getElementById('markAllReadBtn')?.addEventListener('click', markAllNotificationsRead);
    
    // Notifications panel
    document.getElementById('notificationBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('notificationsPanel').classList.toggle('active');
        document.getElementById('settingsDropdown').classList.remove('active');
    });
    
    // Settings dropdown
    document.getElementById('settingsBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('settingsDropdown').classList.toggle('active');
        document.getElementById('notificationsPanel').classList.remove('active');
    });
    
    document.getElementById('changePasswordBtn')?.addEventListener('click', () => {
        document.getElementById('settingsDropdown').classList.remove('active');
        document.getElementById('passwordForm').reset();
        openModal('passwordModal');
    });
    
    document.getElementById('telegramLinkBtn')?.addEventListener('click', () => {
        document.getElementById('settingsDropdown').classList.remove('active');
        showTelegramModal();
    });
    
    document.getElementById('checkOverdueBtn')?.addEventListener('click', () => {
        document.getElementById('settingsDropdown').classList.remove('active');
        checkOverdueJobs();
    });
    
    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#notificationBtn') && !e.target.closest('#notificationsPanel')) {
            document.getElementById('notificationsPanel').classList.remove('active');
        }
        if (!e.target.closest('#settingsBtn') && !e.target.closest('#settingsDropdown')) {
            document.getElementById('settingsDropdown').classList.remove('active');
        }
    });
    
    // Filter
    document.getElementById('assignmentStatusFilter')?.addEventListener('change', renderAssignmentsTable);
    
    // Chat
    document.getElementById('sendMessageBtn')?.addEventListener('click', sendMessage);
    document.getElementById('chatMessageInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
    
    // Chat file upload
    document.getElementById('chatFileInput')?.addEventListener('change', async (e) => {
        if (e.target.files[0]) {
            await uploadChatFile(e.target.files[0]);
            e.target.value = '';
        }
    });
    
    document.getElementById('miniChatSend')?.addEventListener('click', sendMiniChatMessage);
    document.getElementById('miniChatInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMiniChatMessage();
    });
    
    // File uploads
    document.getElementById('submissionFile')?.addEventListener('change', async (e) => {
        if (e.target.files[0] && currentChatAssignment) {
            await handleFileUpload(e.target.files[0], currentChatAssignment, 'submission');
            e.target.value = '';
        }
    });
    
    document.getElementById('adminInstructionFile')?.addEventListener('change', async (e) => {
        if (e.target.files[0] && currentChatAssignment) {
            await handleFileUpload(e.target.files[0], currentChatAssignment, 'instructions');
            e.target.value = '';
        }
    });
    
    // Payment writer balance
    document.getElementById('paymentWriter')?.addEventListener('change', async (e) => {
        const writerId = e.target.value;
        if (writerId && paymentSummary.length) {
            const writer = paymentSummary.find(p => p.writer_id === parseInt(writerId));
            document.getElementById('writerBalance').textContent = formatCurrency(writer?.balance_owed || 0);
        }
    });
    
    // Default report dates
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    document.getElementById('reportStartDate').value = firstDay.toISOString().split('T')[0];
    document.getElementById('reportEndDate').value = today.toISOString().split('T')[0];
    
    // Poll for new notifications
    setInterval(loadNotifications, 60000);
    setInterval(loadUnreadCount, 30000);
    
    // Mobile keyboard handling
    initMobileKeyboardHandling();
});

// Mobile keyboard handling for chat
function initMobileKeyboardHandling() {
    if (!('visualViewport' in window)) return;
    
    const viewport = window.visualViewport;
    let initialHeight = viewport.height;
    
    viewport.addEventListener('resize', () => {
        const heightDiff = initialHeight - viewport.height;
        const keyboardOpen = heightDiff > 150; // Keyboard is likely open
        
        document.body.classList.toggle('keyboard-open', keyboardOpen);
        
        if (keyboardOpen) {
            // Scroll chat to bottom when keyboard opens
            const chatMessages = document.getElementById('chatMessages');
            const miniChatMessages = document.getElementById('miniChatMessages');
            
            if (chatMessages) {
                setTimeout(() => chatMessages.scrollTop = chatMessages.scrollHeight, 100);
            }
            if (miniChatMessages) {
                setTimeout(() => miniChatMessages.scrollTop = miniChatMessages.scrollHeight, 100);
            }
        }
    });
    
    // Update initial height on orientation change
    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            initialHeight = viewport.height;
        }, 300);
    });
    
    // Focus handling for inputs
    document.querySelectorAll('input[type="text"], textarea').forEach(input => {
        input.addEventListener('focus', () => {
            setTimeout(() => {
                input.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        });
    });
}
