// ========================================
// WriterHub Pro - Application Logic
// ========================================

// Data Store
const DataStore = {
    writers: JSON.parse(localStorage.getItem('writers')) || [],
    assignments: JSON.parse(localStorage.getItem('assignments')) || [],
    payments: JSON.parse(localStorage.getItem('payments')) || [],

    save() {
        localStorage.setItem('writers', JSON.stringify(this.writers));
        localStorage.setItem('assignments', JSON.stringify(this.assignments));
        localStorage.setItem('payments', JSON.stringify(this.payments));
    },

    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }
};

// ========================================
// Utility Functions
// ========================================

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function showToast(type, title, message) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle'
    };

    toast.innerHTML = `
        <i class="fas ${icons[type]}"></i>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ========================================
// Navigation
// ========================================

function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const pages = document.querySelectorAll('.page');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetPage = item.dataset.page;

            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            pages.forEach(page => {
                page.classList.remove('active');
                if (page.id === `${targetPage}-page`) {
                    page.classList.add('active');
                }
            });

            // Close sidebar on mobile
            document.querySelector('.sidebar').classList.remove('active');
        });
    });

    // View all links
    document.querySelectorAll('.view-all').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetPage = link.dataset.page;
            document.querySelector(`[data-page="${targetPage}"]`).click();
        });
    });

    // Mobile menu toggle
    document.querySelector('.menu-toggle').addEventListener('click', () => {
        document.querySelector('.sidebar').classList.toggle('active');
    });
}

// ========================================
// Modal Management
// ========================================

function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function initModals() {
    // Close buttons
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => {
            closeModal(btn.dataset.close);
        });
    });

    // Close on backdrop click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });

    // ESC key to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.active').forEach(modal => {
                modal.classList.remove('active');
            });
        }
    });
}

// ========================================
// Writers Management
// ========================================

function getWriterById(id) {
    return DataStore.writers.find(w => w.id === id);
}

function calculateWriterEarnings(writerId) {
    return DataStore.assignments
        .filter(a => a.writerId === writerId && a.status === 'completed')
        .reduce((sum, a) => sum + a.amount, 0);
}

function calculateWriterPaid(writerId) {
    return DataStore.payments
        .filter(p => p.writerId === writerId)
        .reduce((sum, p) => sum + p.amount, 0);
}

function calculateWriterOwed(writerId) {
    return calculateWriterEarnings(writerId) - calculateWriterPaid(writerId);
}

function getWriterAssignmentCount(writerId) {
    return DataStore.assignments.filter(a => a.writerId === writerId).length;
}

function renderWritersTable(filter = 'all', search = '') {
    const tbody = document.getElementById('writersTableBody');
    let writers = [...DataStore.writers];

    // Apply filters
    if (filter !== 'all') {
        writers = writers.filter(w => w.status === filter);
    }
    if (search) {
        const searchLower = search.toLowerCase();
        writers = writers.filter(w => 
            w.name.toLowerCase().includes(searchLower) ||
            w.email.toLowerCase().includes(searchLower)
        );
    }

    if (writers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7">
                    <div class="empty-state">
                        <i class="fas fa-users"></i>
                        <h3>No writers found</h3>
                        <p>Add your first writer to get started</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = writers.map(writer => {
        const totalOwed = calculateWriterOwed(writer.id);
        const assignmentCount = getWriterAssignmentCount(writer.id);

        return `
            <tr>
                <td>
                    <div class="writer-cell">
                        <div class="writer-avatar">${getInitials(writer.name)}</div>
                        <span>${writer.name}</span>
                    </div>
                </td>
                <td>${writer.email}</td>
                <td>${formatCurrency(writer.rate)}</td>
                <td>${assignmentCount}</td>
                <td><strong>${formatCurrency(totalOwed)}</strong></td>
                <td><span class="status-badge ${writer.status}">${writer.status}</span></td>
                <td>
                    <div class="actions">
                        <button class="action-btn edit" onclick="editWriter('${writer.id}')" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="action-btn delete" onclick="deleteWriter('${writer.id}')" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function populateWriterDropdowns() {
    const activeWriters = DataStore.writers.filter(w => w.status === 'active');
    const options = activeWriters.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
    
    document.getElementById('assignmentWriter').innerHTML = 
        '<option value="">Select Writer</option>' + options;
    
    document.getElementById('assignmentWriterFilter').innerHTML = 
        '<option value="all">All Writers</option>' + options;
    
    document.getElementById('paymentWriter').innerHTML = 
        '<option value="">Select Writer</option>' + options;
}

function initWriterForm() {
    const form = document.getElementById('writerForm');
    
    document.getElementById('addWriterBtn').addEventListener('click', () => {
        document.getElementById('writerModalTitle').textContent = 'Add New Writer';
        form.reset();
        document.getElementById('writerId').value = '';
        openModal('writerModal');
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const id = document.getElementById('writerId').value;
        const writerData = {
            name: document.getElementById('writerName').value.trim(),
            email: document.getElementById('writerEmail').value.trim(),
            phone: document.getElementById('writerPhone').value.trim(),
            rate: parseFloat(document.getElementById('writerRate').value),
            status: document.getElementById('writerStatusSelect').value,
            notes: document.getElementById('writerNotes').value.trim()
        };

        if (id) {
            // Update existing writer
            const index = DataStore.writers.findIndex(w => w.id === id);
            DataStore.writers[index] = { ...DataStore.writers[index], ...writerData };
            showToast('success', 'Writer Updated', `${writerData.name} has been updated successfully`);
        } else {
            // Add new writer
            writerData.id = DataStore.generateId();
            writerData.createdAt = new Date().toISOString();
            DataStore.writers.push(writerData);
            showToast('success', 'Writer Added', `${writerData.name} has been added to your team`);
        }

        DataStore.save();
        closeModal('writerModal');
        renderWritersTable();
        populateWriterDropdowns();
        updateDashboard();
    });
}

function editWriter(id) {
    const writer = getWriterById(id);
    if (!writer) return;

    document.getElementById('writerModalTitle').textContent = 'Edit Writer';
    document.getElementById('writerId').value = writer.id;
    document.getElementById('writerName').value = writer.name;
    document.getElementById('writerEmail').value = writer.email;
    document.getElementById('writerPhone').value = writer.phone || '';
    document.getElementById('writerRate').value = writer.rate;
    document.getElementById('writerStatusSelect').value = writer.status;
    document.getElementById('writerNotes').value = writer.notes || '';

    openModal('writerModal');
}

function deleteWriter(id) {
    const writer = getWriterById(id);
    if (!writer) return;

    const hasAssignments = DataStore.assignments.some(a => a.writerId === id);
    
    document.getElementById('confirmMessage').textContent = hasAssignments
        ? `Are you sure you want to delete ${writer.name}? This writer has assignments. The assignments will remain but be unassigned.`
        : `Are you sure you want to delete ${writer.name}?`;

    openModal('confirmModal');

    document.getElementById('confirmActionBtn').onclick = () => {
        DataStore.writers = DataStore.writers.filter(w => w.id !== id);
        
        // Unassign related assignments
        DataStore.assignments.forEach(a => {
            if (a.writerId === id) {
                a.writerId = null;
                a.writerName = 'Unassigned';
            }
        });

        DataStore.save();
        closeModal('confirmModal');
        renderWritersTable();
        populateWriterDropdowns();
        updateDashboard();
        showToast('success', 'Writer Deleted', `${writer.name} has been removed`);
    };
}

// ========================================
// Assignments Management
// ========================================

function getAssignmentById(id) {
    return DataStore.assignments.find(a => a.id === id);
}

function calculateAssignmentAmount(wordCount, writerId, customRate = null) {
    if (customRate) return wordCount * customRate;
    const writer = getWriterById(writerId);
    return writer ? wordCount * writer.rate : 0;
}

function renderAssignmentsTable(statusFilter = 'all', writerFilter = 'all', search = '') {
    const tbody = document.getElementById('assignmentsTableBody');
    let assignments = [...DataStore.assignments];

    // Apply filters
    if (statusFilter !== 'all') {
        assignments = assignments.filter(a => a.status === statusFilter);
    }
    if (writerFilter !== 'all') {
        assignments = assignments.filter(a => a.writerId === writerFilter);
    }
    if (search) {
        const searchLower = search.toLowerCase();
        assignments = assignments.filter(a => 
            a.title.toLowerCase().includes(searchLower)
        );
    }

    // Sort by deadline
    assignments.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

    if (assignments.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8">
                    <div class="empty-state">
                        <i class="fas fa-tasks"></i>
                        <h3>No assignments found</h3>
                        <p>Create a new assignment to get started</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = assignments.map(assignment => {
        const writer = getWriterById(assignment.writerId);
        const writerName = writer ? writer.name : 'Unassigned';
        const isOverdue = new Date(assignment.deadline) < new Date() && assignment.status !== 'completed';

        return `
            <tr>
                <td><strong>${assignment.title}</strong></td>
                <td>
                    <div class="writer-cell">
                        ${writer ? `<div class="writer-avatar">${getInitials(writerName)}</div>` : ''}
                        <span>${writerName}</span>
                    </div>
                </td>
                <td>${assignment.wordCount.toLocaleString()}</td>
                <td style="${isOverdue ? 'color: var(--accent-red);' : ''}">
                    ${formatDate(assignment.deadline)}
                    ${isOverdue ? '<i class="fas fa-exclamation-circle" style="margin-left: 4px;"></i>' : ''}
                </td>
                <td><strong>${formatCurrency(assignment.amount)}</strong></td>
                <td><span class="status-badge ${assignment.status}">${assignment.status.replace('-', ' ')}</span></td>
                <td><span class="status-badge ${assignment.paid ? 'paid' : 'unpaid'}">${assignment.paid ? 'Paid' : 'Unpaid'}</span></td>
                <td>
                    <div class="actions">
                        <button class="action-btn edit" onclick="editAssignment('${assignment.id}')" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="action-btn delete" onclick="deleteAssignment('${assignment.id}')" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function updateCalculatedAmount() {
    const wordCount = parseInt(document.getElementById('assignmentWordCount').value) || 0;
    const writerId = document.getElementById('assignmentWriter').value;
    const customRate = parseFloat(document.getElementById('assignmentRate').value) || null;
    
    const amount = calculateAssignmentAmount(wordCount, writerId, customRate);
    document.getElementById('calculatedAmount').textContent = formatCurrency(amount);
}

function initAssignmentForm() {
    const form = document.getElementById('assignmentForm');

    document.getElementById('addAssignmentBtn').addEventListener('click', () => {
        document.getElementById('assignmentModalTitle').textContent = 'New Assignment';
        form.reset();
        document.getElementById('assignmentId').value = '';
        document.getElementById('calculatedAmount').textContent = formatCurrency(0);
        
        // Set default deadline to tomorrow
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        document.getElementById('assignmentDeadline').value = tomorrow.toISOString().split('T')[0];
        
        openModal('assignmentModal');
    });

    // Auto-calculate amount
    document.getElementById('assignmentWordCount').addEventListener('input', updateCalculatedAmount);
    document.getElementById('assignmentWriter').addEventListener('change', updateCalculatedAmount);
    document.getElementById('assignmentRate').addEventListener('input', updateCalculatedAmount);

    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const id = document.getElementById('assignmentId').value;
        const writerId = document.getElementById('assignmentWriter').value;
        const writer = getWriterById(writerId);
        const wordCount = parseInt(document.getElementById('assignmentWordCount').value);
        const customRate = parseFloat(document.getElementById('assignmentRate').value) || null;

        const assignmentData = {
            title: document.getElementById('assignmentTitle').value.trim(),
            writerId: writerId,
            writerName: writer ? writer.name : 'Unassigned',
            wordCount: wordCount,
            deadline: document.getElementById('assignmentDeadline').value,
            rate: customRate || (writer ? writer.rate : 0),
            amount: calculateAssignmentAmount(wordCount, writerId, customRate),
            status: document.getElementById('assignmentStatusSelect').value,
            description: document.getElementById('assignmentDescription').value.trim()
        };

        if (id) {
            // Update existing assignment
            const index = DataStore.assignments.findIndex(a => a.id === id);
            const existingPaid = DataStore.assignments[index].paid;
            DataStore.assignments[index] = { 
                ...DataStore.assignments[index], 
                ...assignmentData,
                paid: existingPaid
            };
            showToast('success', 'Assignment Updated', `"${assignmentData.title}" has been updated`);
        } else {
            // Add new assignment
            assignmentData.id = DataStore.generateId();
            assignmentData.createdAt = new Date().toISOString();
            assignmentData.paid = false;
            DataStore.assignments.push(assignmentData);
            showToast('success', 'Assignment Created', `"${assignmentData.title}" has been assigned`);
        }

        DataStore.save();
        closeModal('assignmentModal');
        renderAssignmentsTable();
        renderRecentAssignments();
        updateDashboard();
    });
}

function editAssignment(id) {
    const assignment = getAssignmentById(id);
    if (!assignment) return;

    document.getElementById('assignmentModalTitle').textContent = 'Edit Assignment';
    document.getElementById('assignmentId').value = assignment.id;
    document.getElementById('assignmentTitle').value = assignment.title;
    document.getElementById('assignmentWriter').value = assignment.writerId || '';
    document.getElementById('assignmentWordCount').value = assignment.wordCount;
    document.getElementById('assignmentDeadline').value = assignment.deadline;
    document.getElementById('assignmentRate').value = assignment.rate || '';
    document.getElementById('assignmentStatusSelect').value = assignment.status;
    document.getElementById('assignmentDescription').value = assignment.description || '';
    document.getElementById('calculatedAmount').textContent = formatCurrency(assignment.amount);

    openModal('assignmentModal');
}

function deleteAssignment(id) {
    const assignment = getAssignmentById(id);
    if (!assignment) return;

    document.getElementById('confirmMessage').textContent = 
        `Are you sure you want to delete "${assignment.title}"?`;

    openModal('confirmModal');

    document.getElementById('confirmActionBtn').onclick = () => {
        DataStore.assignments = DataStore.assignments.filter(a => a.id !== id);
        DataStore.save();
        closeModal('confirmModal');
        renderAssignmentsTable();
        renderRecentAssignments();
        updateDashboard();
        showToast('success', 'Assignment Deleted', 'The assignment has been removed');
    };
}

// ========================================
// Payments Management
// ========================================

function renderPaymentsTable() {
    const tbody = document.getElementById('paymentsTableBody');
    
    const writersWithBalance = DataStore.writers.map(writer => ({
        ...writer,
        completedAssignments: DataStore.assignments.filter(
            a => a.writerId === writer.id && a.status === 'completed'
        ).length,
        totalEarned: calculateWriterEarnings(writer.id),
        totalPaid: calculateWriterPaid(writer.id),
        balance: calculateWriterOwed(writer.id)
    })).filter(w => w.totalEarned > 0 || w.totalPaid > 0);

    if (writersWithBalance.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6">
                    <div class="empty-state">
                        <i class="fas fa-wallet"></i>
                        <h3>No payment data</h3>
                        <p>Complete assignments to see payment information</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = writersWithBalance.map(writer => `
        <tr>
            <td>
                <div class="writer-cell">
                    <div class="writer-avatar">${getInitials(writer.name)}</div>
                    <span>${writer.name}</span>
                </div>
            </td>
            <td>${writer.completedAssignments}</td>
            <td>${formatCurrency(writer.totalEarned)}</td>
            <td>${formatCurrency(writer.totalPaid)}</td>
            <td><strong style="color: ${writer.balance > 0 ? 'var(--accent-orange)' : 'var(--accent-green)'}">
                ${formatCurrency(writer.balance)}
            </strong></td>
            <td>
                <div class="actions">
                    ${writer.balance > 0 ? `
                        <button class="action-btn pay" onclick="payWriter('${writer.id}')" title="Record Payment">
                            <i class="fas fa-dollar-sign"></i>
                        </button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `).join('');

    // Update totals
    const totalPaid = DataStore.payments.reduce((sum, p) => sum + p.amount, 0);
    const totalPending = writersWithBalance.reduce((sum, w) => sum + Math.max(0, w.balance), 0);
    
    document.getElementById('totalPaid').textContent = formatCurrency(totalPaid);
    document.getElementById('totalPending').textContent = formatCurrency(totalPending);
}

function renderPaymentHistory() {
    const tbody = document.getElementById('paymentHistoryBody');
    
    const payments = [...DataStore.payments].sort((a, b) => 
        new Date(b.date) - new Date(a.date)
    );

    if (payments.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5">
                    <div class="empty-state">
                        <i class="fas fa-history"></i>
                        <h3>No payment history</h3>
                        <p>Payment records will appear here</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = payments.map(payment => {
        const writer = getWriterById(payment.writerId);
        return `
            <tr>
                <td>${formatDate(payment.date)}</td>
                <td>${writer ? writer.name : 'Unknown Writer'}</td>
                <td><strong>${formatCurrency(payment.amount)}</strong></td>
                <td style="text-transform: capitalize;">${payment.method.replace('-', ' ')}</td>
                <td>${payment.reference || '-'}</td>
            </tr>
        `;
    }).join('');
}

function payWriter(writerId) {
    const writer = getWriterById(writerId);
    if (!writer) return;

    document.getElementById('paymentWriter').value = writerId;
    document.getElementById('writerBalance').textContent = formatCurrency(calculateWriterOwed(writerId));
    document.getElementById('paymentAmount').value = calculateWriterOwed(writerId).toFixed(2);
    document.getElementById('paymentDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('paymentReference').value = '';

    openModal('paymentModal');
}

function initPaymentForm() {
    const form = document.getElementById('paymentForm');

    document.getElementById('recordPaymentBtn').addEventListener('click', () => {
        form.reset();
        document.getElementById('writerBalance').textContent = formatCurrency(0);
        document.getElementById('paymentDate').value = new Date().toISOString().split('T')[0];
        openModal('paymentModal');
    });

    document.getElementById('paymentWriter').addEventListener('change', (e) => {
        const writerId = e.target.value;
        if (writerId) {
            const balance = calculateWriterOwed(writerId);
            document.getElementById('writerBalance').textContent = formatCurrency(balance);
            document.getElementById('paymentAmount').value = balance > 0 ? balance.toFixed(2) : '';
        } else {
            document.getElementById('writerBalance').textContent = formatCurrency(0);
        }
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const writerId = document.getElementById('paymentWriter').value;
        const writer = getWriterById(writerId);

        const paymentData = {
            id: DataStore.generateId(),
            writerId: writerId,
            writerName: writer ? writer.name : 'Unknown',
            amount: parseFloat(document.getElementById('paymentAmount').value),
            date: document.getElementById('paymentDate').value,
            method: document.getElementById('paymentMethod').value,
            reference: document.getElementById('paymentReference').value.trim(),
            createdAt: new Date().toISOString()
        };

        DataStore.payments.push(paymentData);
        DataStore.save();

        closeModal('paymentModal');
        renderPaymentsTable();
        renderPaymentHistory();
        renderWritersTable();
        updateDashboard();

        showToast('success', 'Payment Recorded', 
            `${formatCurrency(paymentData.amount)} paid to ${writer ? writer.name : 'writer'}`);
    });
}

// ========================================
// Reports
// ========================================

function generateReport() {
    const startDate = document.getElementById('reportStartDate').value;
    const endDate = document.getElementById('reportEndDate').value;

    let assignments = [...DataStore.assignments];

    // Filter by date range
    if (startDate) {
        assignments = assignments.filter(a => a.createdAt >= startDate);
    }
    if (endDate) {
        assignments = assignments.filter(a => a.createdAt <= endDate + 'T23:59:59');
    }

    // Calculate totals
    const totalAssignments = assignments.length;
    const completedAssignments = assignments.filter(a => a.status === 'completed');
    const totalSpent = completedAssignments.reduce((sum, a) => sum + a.amount, 0);
    const totalWords = assignments.reduce((sum, a) => sum + a.wordCount, 0);
    const avgRate = totalWords > 0 ? totalSpent / totalWords : 0;

    document.getElementById('reportTotalAssignments').textContent = totalAssignments;
    document.getElementById('reportTotalSpent').textContent = formatCurrency(totalSpent);
    document.getElementById('reportTotalWords').textContent = totalWords.toLocaleString();
    document.getElementById('reportAvgRate').textContent = formatCurrency(avgRate);

    // Writer performance table
    const tbody = document.getElementById('reportTableBody');
    const writerStats = {};

    assignments.forEach(a => {
        if (!a.writerId) return;
        
        if (!writerStats[a.writerId]) {
            const writer = getWriterById(a.writerId);
            writerStats[a.writerId] = {
                name: writer ? writer.name : 'Unknown',
                assignments: 0,
                words: 0,
                onTime: 0,
                earned: 0
            };
        }

        writerStats[a.writerId].assignments++;
        writerStats[a.writerId].words += a.wordCount;
        
        if (a.status === 'completed') {
            writerStats[a.writerId].earned += a.amount;
            // Check if completed on time (simplified check)
            writerStats[a.writerId].onTime++;
        }
    });

    const writerStatsArray = Object.values(writerStats).sort((a, b) => b.earned - a.earned);

    if (writerStatsArray.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5">
                    <div class="empty-state">
                        <i class="fas fa-chart-bar"></i>
                        <h3>No data available</h3>
                        <p>Adjust the date range or add more assignments</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = writerStatsArray.map(stats => {
        const onTimeRate = stats.assignments > 0 
            ? Math.round((stats.onTime / stats.assignments) * 100) 
            : 0;

        return `
            <tr>
                <td><strong>${stats.name}</strong></td>
                <td>${stats.assignments}</td>
                <td>${stats.words.toLocaleString()}</td>
                <td>
                    <span style="color: ${onTimeRate >= 80 ? 'var(--accent-green)' : onTimeRate >= 50 ? 'var(--accent-orange)' : 'var(--accent-red)'}">
                        ${onTimeRate}%
                    </span>
                </td>
                <td><strong>${formatCurrency(stats.earned)}</strong></td>
            </tr>
        `;
    }).join('');
}

function initReports() {
    // Set default date range (current month)
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    document.getElementById('reportStartDate').value = firstDay.toISOString().split('T')[0];
    document.getElementById('reportEndDate').value = lastDay.toISOString().split('T')[0];

    document.getElementById('generateReportBtn').addEventListener('click', generateReport);
    
    document.getElementById('exportReportBtn').addEventListener('click', () => {
        // Simple CSV export
        const assignments = DataStore.assignments;
        const csvContent = [
            ['Title', 'Writer', 'Word Count', 'Amount', 'Status', 'Deadline'].join(','),
            ...assignments.map(a => [
                `"${a.title}"`,
                `"${a.writerName || 'Unassigned'}"`,
                a.wordCount,
                a.amount,
                a.status,
                a.deadline
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `writerhub-report-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);

        showToast('success', 'Report Exported', 'CSV file has been downloaded');
    });

    generateReport();
}

// ========================================
// Dashboard
// ========================================

function updateDashboard() {
    // Total writers
    document.getElementById('totalWriters').textContent = DataStore.writers.length;

    // Active assignments
    const activeCount = DataStore.assignments.filter(a => 
        a.status === 'pending' || a.status === 'in-progress'
    ).length;
    document.getElementById('activeAssignments').textContent = activeCount;

    // Pending payments
    const pendingPayments = DataStore.writers.reduce((sum, w) => {
        return sum + Math.max(0, calculateWriterOwed(w.id));
    }, 0);
    document.getElementById('pendingPayments').textContent = formatCurrency(pendingPayments);

    // Completed this month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const completedThisMonth = DataStore.assignments.filter(a => 
        a.status === 'completed' && new Date(a.createdAt) >= monthStart
    ).length;
    document.getElementById('completedThisMonth').textContent = completedThisMonth;
}

function renderRecentAssignments() {
    const container = document.getElementById('recentAssignmentsList');
    const recent = [...DataStore.assignments]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5);

    if (recent.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding: 30px 0;">
                <i class="fas fa-inbox" style="font-size: 2rem;"></i>
                <h3>No assignments yet</h3>
                <p>Create your first assignment</p>
            </div>
        `;
        return;
    }

    container.innerHTML = recent.map(a => `
        <div class="assignment-item">
            <div class="assignment-info">
                <div class="assignment-title">${a.title}</div>
                <div class="assignment-meta">
                    ${a.writerName || 'Unassigned'} • ${a.wordCount.toLocaleString()} words • Due ${formatDate(a.deadline)}
                </div>
            </div>
            <span class="status-badge ${a.status}">${a.status.replace('-', ' ')}</span>
        </div>
    `).join('');
}

function renderTopWriters() {
    const container = document.getElementById('topWritersList');
    
    const writersWithStats = DataStore.writers
        .map(w => ({
            ...w,
            completed: DataStore.assignments.filter(
                a => a.writerId === w.id && a.status === 'completed'
            ).length,
            earnings: calculateWriterEarnings(w.id)
        }))
        .filter(w => w.completed > 0)
        .sort((a, b) => b.completed - a.completed)
        .slice(0, 5);

    if (writersWithStats.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding: 30px 0;">
                <i class="fas fa-trophy" style="font-size: 2rem;"></i>
                <h3>No completed work yet</h3>
                <p>Top writers will appear here</p>
            </div>
        `;
        return;
    }

    container.innerHTML = writersWithStats.map(w => `
        <div class="writer-item">
            <div class="writer-avatar">${getInitials(w.name)}</div>
            <div class="writer-info">
                <div class="writer-name">${w.name}</div>
                <div class="writer-stats">${w.completed} completed assignments</div>
            </div>
            <span class="writer-earnings">${formatCurrency(w.earnings)}</span>
        </div>
    `).join('');
}

// ========================================
// Search
// ========================================

function initSearch() {
    document.getElementById('globalSearch').addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        
        if (query.length < 2) return;

        // Search writers
        const matchedWriters = DataStore.writers.filter(w => 
            w.name.toLowerCase().includes(query) ||
            w.email.toLowerCase().includes(query)
        );

        // Search assignments
        const matchedAssignments = DataStore.assignments.filter(a => 
            a.title.toLowerCase().includes(query)
        );

        // Navigate to relevant page if matches found
        if (matchedWriters.length > 0) {
            document.querySelector('[data-page="writers"]').click();
            document.getElementById('writerSearch').value = query;
            renderWritersTable('all', query);
        } else if (matchedAssignments.length > 0) {
            document.querySelector('[data-page="assignments"]').click();
            document.getElementById('assignmentSearch').value = query;
            renderAssignmentsTable('all', 'all', query);
        }
    });

    // Writer search
    document.getElementById('writerSearch').addEventListener('input', (e) => {
        const status = document.getElementById('writerStatusFilter').value;
        renderWritersTable(status, e.target.value);
    });

    document.getElementById('writerStatusFilter').addEventListener('change', (e) => {
        const search = document.getElementById('writerSearch').value;
        renderWritersTable(e.target.value, search);
    });

    // Assignment search
    document.getElementById('assignmentSearch').addEventListener('input', (e) => {
        const status = document.getElementById('assignmentStatusFilter').value;
        const writer = document.getElementById('assignmentWriterFilter').value;
        renderAssignmentsTable(status, writer, e.target.value);
    });

    document.getElementById('assignmentStatusFilter').addEventListener('change', (e) => {
        const writer = document.getElementById('assignmentWriterFilter').value;
        const search = document.getElementById('assignmentSearch').value;
        renderAssignmentsTable(e.target.value, writer, search);
    });

    document.getElementById('assignmentWriterFilter').addEventListener('change', (e) => {
        const status = document.getElementById('assignmentStatusFilter').value;
        const search = document.getElementById('assignmentSearch').value;
        renderAssignmentsTable(status, e.target.value, search);
    });
}

// ========================================
// Initialization
// ========================================

function init() {
    initNavigation();
    initModals();
    initWriterForm();
    initAssignmentForm();
    initPaymentForm();
    initSearch();
    initReports();

    // Render all views
    populateWriterDropdowns();
    renderWritersTable();
    renderAssignmentsTable();
    renderPaymentsTable();
    renderPaymentHistory();
    renderRecentAssignments();
    renderTopWriters();
    updateDashboard();

    console.log('WriterHub Pro initialized successfully!');
}

// Start the app
document.addEventListener('DOMContentLoaded', init);
