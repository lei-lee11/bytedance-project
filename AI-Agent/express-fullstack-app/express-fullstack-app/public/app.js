document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const authContainer = document.getElementById('authContainer');
    const tasksContainer = document.getElementById('tasksContainer');
    const taskList = document.getElementById('taskList');
    const usernameDisplay = document.getElementById('usernameDisplay');
    const loginNavItem = document.getElementById('loginNavItem');
    const registerNavItem = document.getElementById('registerNavItem');
    const logoutNavItem = document.getElementById('logoutNavItem');
    const userNavItem = document.getElementById('userNavItem');

    // Form Elements
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const addTaskForm = document.getElementById('addTaskForm');
    const editTaskForm = document.getElementById('editTaskForm');

    // Modal Elements
    const loginModal = $('#loginModal');
    const registerModal = $('#registerModal');
    const addTaskModal = $('#addTaskModal');
    const editTaskModal = $('#editTaskModal');

    // API Base URL
    const API_BASE_URL = 'http://localhost:3000/api';

    // Check if user is logged in
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user'));

    if (token && user) {
        showTasksUI(user);
        fetchTasks();
    } else {
        showAuthUI();
    }

    // Event Listeners
    loginForm.addEventListener('submit', handleLogin);
    registerForm.addEventListener('submit', handleRegister);
    addTaskForm.addEventListener('submit', handleAddTask);
    editTaskForm.addEventListener('submit', handleEditTask);
    document.getElementById('logoutLink').addEventListener('click', handleLogout);

    // Authentication Functions
    async function handleLogin(e) {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;

        try {
            const response = await fetch(`${API_BASE_URL}/auth/login`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (!response.ok) throw new Error(data.message || 'Login failed');

            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));

            loginForm.reset();
            loginModal.modal('hide');
            showTasksUI(data.user);
            fetchTasks();
        } catch (error) {
            alert(error.message);
        }
    }

    async function handleRegister(e) {
        e.preventDefault();
        const username = document.getElementById('registerUsername').value;
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;

        try {
            const response = await fetch(`${API_BASE_URL}/auth/register`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ username, email, password })
            });

            const data = await response.json();

            if (!response.ok) throw new Error(data.message || 'Registration failed');

            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));

            registerForm.reset();
            registerModal.modal('hide');
            showTasksUI(data.user);
            fetchTasks();
        } catch (error) {
            alert(error.message);
        }
    }

    function handleLogout() {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        showAuthUI();
    }

    // Task Functions
    async function fetchTasks() {
        const token = localStorage.getItem('token');
        if (!token) return;

        try {
            const response = await fetch(`${API_BASE_URL}/tasks`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) throw new Error('Failed to fetch tasks');

            const tasks = await response.json();
            renderTasks(tasks);
        } catch (error) {
            alert(error.message);
            handleLogout();
        }
    }

    async function handleAddTask(e) {
        e.preventDefault();
        const title = document.getElementById('taskTitle').value;
        const description = document.getElementById('taskDescription').value;
        const status = document.getElementById('taskStatus').value;
        const dueDate = document.getElementById('taskDueDate').value;
        const token = localStorage.getItem('token');

        if (!token) return;

        try {
            const response = await fetch(`${API_BASE_URL}/tasks`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ title, description, status, dueDate })
            });

            const data = await response.json();

            if (!response.ok) throw new Error(data.message || 'Failed to create task');

            addTaskForm.reset();
            addTaskModal.modal('hide');
            fetchTasks();
        } catch (error) {
            alert(error.message);
        }
    }

    async function handleEditTask(e) {
        e.preventDefault();
        const taskId = document.getElementById('editTaskId').value;
        const title = document.getElementById('editTaskTitle').value;
        const description = document.getElementById('editTaskDescription').value;
        const status = document.getElementById('editTaskStatus').value;
        const dueDate = document.getElementById('editTaskDueDate').value;
        const token = localStorage.getItem('token');

        if (!token || !taskId) return;

        try {
            const response = await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ title, description, status, dueDate })
            });

            const data = await response.json();

            if (!response.ok) throw new Error(data.message || 'Failed to update task');

            editTaskForm.reset();
            editTaskModal.modal('hide');
            fetchTasks();
        } catch (error) {
            alert(error.message);
        }
    }

    async function handleDeleteTask(taskId) {
        const token = localStorage.getItem('token');
        if (!token || !taskId) return;

        if (!confirm('Are you sure you want to delete this task?')) return;

        try {
            const response = await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();

            if (!response.ok) throw new Error(data.message || 'Failed to delete task');

            fetchTasks();
        } catch (error) {
            alert(error.message);
        }
    }

    // UI Functions
    function showAuthUI() {
        authContainer.classList.remove('d-none');
        tasksContainer.classList.add('d-none');
        loginNavItem.classList.remove('d-none');
        registerNavItem.classList.remove('d-none');
        logoutNavItem.classList.add('d-none');
        userNavItem.classList.add('d-none');
    }

    function showTasksUI(user) {
        authContainer.classList.add('d-none');
        tasksContainer.classList.remove('d-none');
        loginNavItem.classList.add('d-none');
        registerNavItem.classList.add('d-none');
        logoutNavItem.classList.remove('d-none');
        userNavItem.classList.remove('d-none');
        usernameDisplay.textContent = user.username;
    }

    function renderTasks(tasks) {
        taskList.innerHTML = '';

        if (tasks.length === 0) {
            taskList.innerHTML = `
                <div class="col-12">
                    <div class="card text-center">
                        <div class="card-body">
                            <h5 class="card-title">No tasks found</h5>
                            <p class="card-text">Click the "Add Task" button to create your first task.</p>
                        </div>
                    </div>
                </div>
            `;
            return;
        }

        tasks.forEach(task => {
            const taskCard = document.createElement('div');
            taskCard.className = 'col-md-4 col-sm-6';
            taskCard.innerHTML = `
                <div class="card task-card">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <span class="task-status status-${task.status}">${capitalizeFirstLetter(task.status.replace('-', ' '))}</span>
                        </div>
                        <h5 class="card-title">${task.title}</h5>
                        ${task.description ? `<p class="card-text task-description">${task.description}</p>` : ''}
                        ${task.dueDate ? `<p class="task-due-date">Due: ${formatDate(task.dueDate)}</p>` : ''}
                        <div class="task-actions mt-3">
                            <button class="btn btn-sm btn-primary edit-task" data-id="${task.id}">Edit</button>
                            <button class="btn btn-sm btn-danger delete-task" data-id="${task.id}">Delete</button>
                        </div>
                    </div>
                </div>
            `;

            taskList.appendChild(taskCard);
        });

        // Add event listeners to edit and delete buttons
        document.querySelectorAll('.edit-task').forEach(button => {
            button.addEventListener('click', () => {
                const taskId = button.getAttribute('data-id');
                openEditModal(taskId);
            });
        });

        document.querySelectorAll('.delete-task').forEach(button => {
            button.addEventListener('click', () => {
                const taskId = button.getAttribute('data-id');
                handleDeleteTask(taskId);
            });
        });
    }

    async function openEditModal(taskId) {
        const token = localStorage.getItem('token');
        if (!token || !taskId) return;

        try {
            const response = await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) throw new Error('Failed to fetch task details');

            const task = await response.json();

            document.getElementById('editTaskId').value = task.id;
            document.getElementById('editTaskTitle').value = task.title;
            document.getElementById('editTaskDescription').value = task.description || '';
            document.getElementById('editTaskStatus').value = task.status;
            document.getElementById('editTaskDueDate').value = task.dueDate ? task.dueDate.split('T')[0] : '';

            editTaskModal.modal('show');
        } catch (error) {
            alert(error.message);
        }
    }

    // Helper Functions
    function capitalizeFirstLetter(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }
});
