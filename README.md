# User Management Service API Documentation

A robust user management service built with Node.js, Express, and Redis, featuring role-based access control (RBAC), Redis Bloom filters for efficient username validation, and comprehensive caching strategies.


## Features

- 🔐 **Authentication & Authorization**
  - JWT-based authentication
  - Role-based access control (Admin, Editor, Viewer)
  - Secure password hashing
  - Token-based session management

- 📝 **User Management**
  - CRUD operations for users
  - Real-time username validation
  - Email verification
  - Profile updates with field validation
  - Role management (Admin only)

- 🚀 **Performance Optimizations**
  - Redis caching for frequently accessed data
  - Bloom filters for quick username availability checks
  - Efficient query pagination
  - Response compression

- 🛡️ **Security Features**
  - Input validation and sanitization
  - Rate limiting
  - CORS protection
  - XSS prevention
  - Password strength requirements

