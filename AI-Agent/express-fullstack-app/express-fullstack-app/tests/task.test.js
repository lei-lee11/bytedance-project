const request = require('supertest');
const app = require('../app');
const { User, Task } = require('../models');
const jwt = require('jsonwebtoken');
require('dotenv').config();

let token;
let testUserId;

describe('Task API', () => {
  beforeAll(async () => {
    // Sync database and clear data
    await User.sync({ force: true });
    await Task.sync({ force: true });

    // Create test user
    const user = await User.create({
      username: 'taskuser',
      email: 'task@example.com',
      password: 'taskpassword123'
    });
    testUserId = user.id;

    // Generate token
    token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: '1h'
    });
  });

  describe('GET /api/tasks', () => {
    it('should get all tasks for authenticated user', async () => {
      // Create test tasks
      await Task.bulkCreate([
        { title: 'Test Task 1', description: 'Description 1', status: 'pending', userId: testUserId },
        { title: 'Test Task 2', description: 'Description 2', status: 'in_progress', userId: testUserId }
      ]);

      const res = await request(app)
        .get('/api/tasks')
        .set('Authorization', `Bearer ${token}`);

      expect(res.statusCode).toEqual(200);
      expect(res.body.length).toBe(2);
      expect(res.body[0]).toHaveProperty('title', 'Test Task 1');
      expect(res.body[1]).toHaveProperty('title', 'Test Task 2');
    });

    it('should not get tasks without authentication', async () => {
      const res = await request(app)
        .get('/api/tasks');

      expect(res.statusCode).toEqual(401);
      expect(res.body).toHaveProperty('message', 'Authentication required');
    });
  });

  describe('POST /api/tasks', () => {
    it('should create a new task', async () => {
      const newTask = {
        title: 'New Task',
        description: 'New Task Description',
        status: 'pending',
        dueDate: new Date('2023-12-31').toISOString()
      };

      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${token}`)
        .send(newTask);

      expect(res.statusCode).toEqual(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.title).toBe(newTask.title);
      expect(res.body.description).toBe(newTask.description);
      expect(res.body.status).toBe(newTask.status);
      expect(res.body.userId).toBe(testUserId);
    });

    it('should not create task without title', async () => {
      const invalidTask = {
        description: 'No title task',
        status: 'pending'
      };

      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${token}`)
        .send(invalidTask);

      expect(res.statusCode).toEqual(400);
      expect(res.body).toHaveProperty('message');
    });
  });

  describe('PUT /api/tasks/:id', () => {
    let testTaskId;

    beforeAll(async () => {
      const task = await Task.create({
        title: 'Update Test Task',
        description: 'To be updated',
        status: 'pending',
        userId: testUserId
      });
      testTaskId = task.id;
    });

    it('should update a task', async () => {
      const updatedTask = {
        title: 'Updated Task',
        description: 'Updated Description',
        status: 'completed'
      };

      const res = await request(app)
        .put(`/api/tasks/${testTaskId}`)
        .set('Authorization', `Bearer ${token}`)
        .send(updatedTask);

      expect(res.statusCode).toEqual(200);
      expect(res.body.title).toBe(updatedTask.title);
      expect(res.body.description).toBe(updatedTask.description);
      expect(res.body.status).toBe(updatedTask.status);
    });

    it('should not update task that does not belong to user', async () => {
      // Create another user's task
      const otherUser = await User.create({
        username: 'otheruser',
        email: 'other@example.com',
        password: 'otherpass'
      });
      const otherTask = await Task.create({
        title: 'Other User Task',
        description: 'Not accessible',
        status: 'pending',
        userId: otherUser.id
      });

      const res = await request(app)
        .put(`/api/tasks/${otherTask.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Hacked Task'
        });

      expect(res.statusCode).toEqual(403);
      expect(res.body).toHaveProperty('message', 'Not authorized to access this task');
    });
  });

  describe('DELETE /api/tasks/:id', () => {
    let testTaskId;

    beforeAll(async () => {
      const task = await Task.create({
        title: 'Delete Test Task',
        description: 'To be deleted',
        status: 'pending',
        userId: testUserId
      });
      testTaskId = task.id;
    });

    it('should delete a task', async () => {
      const res = await request(app)
        .delete(`/api/tasks/${testTaskId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.statusCode).toEqual(200);
      expect(res.body).toHaveProperty('message', 'Task deleted successfully');

      // Verify task is deleted
      const deletedTask = await Task.findByPk(testTaskId);
      expect(deletedTask).toBeNull();
    });

    it('should not delete non-existent task', async () => {
      const res = await request(app)
        .delete('/api/tasks/99999')
        .set('Authorization', `Bearer ${token}`);

      expect(res.statusCode).toEqual(404);
      expect(res.body).toHaveProperty('message', 'Task not found');
    });
  });
});
