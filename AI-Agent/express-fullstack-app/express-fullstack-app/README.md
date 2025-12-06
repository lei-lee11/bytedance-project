# Task Manager API

A full-stack task management application with user authentication and task tracking features.

## Project Overview

This application provides a RESTful API for managing tasks with user authentication. It includes a responsive frontend interface for users to interact with the API.

## Features

- User registration and authentication (JWT)
- Task CRUD operations (Create, Read, Update, Delete)
- Task status management (Pending, In Progress, Completed)
- Due date tracking
- Responsive frontend interface

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables (create a .env file):
   ```
   PORT=3000
   JWT_SECRET=your_jwt_secret_key
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=your_password
   DB_NAME=task_manager
   ```
4. Start the server:
   ```bash
   npm start
   ```

## API Documentation

### Authentication Endpoints

- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login and get token

### Task Endpoints (protected by JWT)

- `GET /api/tasks` - Get all tasks for current user
- `GET /api/tasks/:id` - Get a specific task
- `POST /api/tasks` - Create a new task
- `PUT /api/tasks/:id` - Update a task
- `DELETE /api/tasks/:id` - Delete a task

## Frontend Interface

The frontend is available at `http://localhost:3000` and includes:
- User login/registration forms
- Task list display
- Task creation and editing modals
- Responsive design for mobile and desktop

## Testing

To run tests:
1. Install dev dependencies:
   ```bash
   npm install --save-dev jest supertest cross-env
   ```
2. Run tests:
   ```bash
   npm test
   ```

## Technologies Used

- Backend: Node.js, Express, Sequelize, JWT
- Frontend: HTML, CSS, JavaScript, Bootstrap
- Database: MySQL (development), SQLite (testing)

## License

This project is licensed under the MIT License.
