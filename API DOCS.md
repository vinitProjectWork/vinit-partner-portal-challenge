
## Overview

Base URL: `http://localhost:3001/api`

### API Versioning
Current version: v1 (implicit in URL)

### Request Headers
All requests must include:
```
Content-Type: application/json
```

Authenticated endpoints require:
```
Authorization: Bearer <jwt_token>
```

### Response Format
All responses follow this structure:
```json
{
  "data": {},        // Success response data
  "error": null,     // Error message if any
  "metadata": {}     // Pagination, timestamps, etc.
}
```

## Authentication

### JWT Token
- Tokens expire after 24 hours
- Tokens must be included in the Authorization header
- Format: `Bearer <token>`

### Role-Based Access
Three roles are available:
- `admin`: Full access to all endpoints
- `editor`: Can read and update users, cannot delete or manage roles
- `viewer`: Can only read public information

## Error Handling

### HTTP Status Codes
- `200`: Success
- `201`: Resource created
- `400`: Bad request
- `401`: Unauthorized
- `403`: Forbidden
- `404`: Not found
- `429`: Too many requests
- `500`: Internal server error

### Error Response Format
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": {}
  }
}
```

### Common Error Codes
- `VALIDATION_ERROR`: Invalid input data
- `AUTHENTICATION_ERROR`: Invalid or missing token
- `AUTHORIZATION_ERROR`: Insufficient permissions
- `RESOURCE_NOT_FOUND`: Requested resource not found
- `DUPLICATE_ERROR`: Resource already exists
- `RATE_LIMIT_ERROR`: Too many requests

## Rate Limiting

### Global Limits
- 100 requests per minute per IP
- Applies to all endpoints except where noted

### Endpoint-Specific Limits
- Username validation: 20 requests per minute
- Authentication endpoints: 10 requests per minute

### Rate Limit Headers
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1640995200
```

## Endpoints

### Authentication Endpoints

#### Sign Up
Create a new user account.

**Role:** if any user's doesn't exists then 1st user created will be admin by role


**Endpoint:** `POST /auth/signup`

**Rate Limit:** 10 requests per minute

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "StrongP@ss123",
  "username": "johndoe",
  "fullName": "John Doe",
  "role": "viewer" // optional
}
```

**Validation Rules:**
- `email`:
  - Required
  - Valid email format
  - Unique in system
  - Max length: 255 characters
- `password`:
  - Required
  - Minimum 8 characters
  - Must contain: uppercase, lowercase, number, special character
  - Max length: 72 characters (bcrypt limitation)
- `username`:
  - Required
  - 3-30 characters
  - Alphanumeric with underscore and hyphen
  - Unique in system
- `fullName`:
  - Optional
  - 1-100 characters
  - Allows letters, spaces, hyphens, apostrophes
- `role`:
  - Optional
  - Can be Only Used by Admin
  - Allows Enum ("viewer"-for default, "editor", "admin")

**Success Response (201 Created):**
```json
{
  "data": {
    "user": {
      "id": "user:johndoe",
      "email": "user@example.com",
      "username": "johndoe",
      "fullName": "John Doe",
      "role": "viewer",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

**Error Responses:**
- `400 Bad Request`:
  ```json
  {
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Invalid input data",
      "details": {
        "email": "Email is already in use",
        "password": "Password must contain at least one uppercase letter"
      }
    }
  }
  ```
- `429 Too Many Requests`:
  ```json
  {
    "error": {
      "code": "RATE_LIMIT_ERROR",
      "message": "Too many signup attempts. Try again in 60 seconds"
    }
  }
  ```

#### Login
Authenticate user and get access token.

**Endpoint:** `POST /auth/login`

**Rate Limit:** 10 requests per minute

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "StrongP@ss123"
}
```

**Success Response (200 OK):**
```json
{
  "data": {
    "user": {
      "id": "user:johndoe",
      "email": "user@example.com",
      "username": "johndoe",
      "fullName": "John Doe",
      "role": "viewer",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

**Error Responses:**
- `401 Unauthorized`:
  ```json
  {
    "error": {
      "code": "AUTHENTICATION_ERROR",
      "message": "Invalid email or password"
    }
  }
  ```

### User Management Endpoints

#### Get Own User Info
Get the currently authenticated user's information.

**Endpoint:** `GET /users/`

**Authentication Required:** Yes

**Request Headers:**
```
Authorization: Bearer <jwt_token>
```

**Success Response (200 OK):**
```json
{
  "data": {
    "user": {
      "id": "user:johndoe",
      "email": "user@example.com",
      "username": "johndoe",
      "fullName": "John Doe",
      "role": "viewer",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

#### Get All Users
Get a list of all users (admin/editor only).

**Endpoint:** `GET /users/all`

**Authentication Required:** Yes
**Required Role:** admin, editor

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20, max: 100)
- `sort` (optional): Sort field (createdAt, username, email)
- `order` (optional): Sort order (asc, desc)
- `role` (optional): Filter by role
- `search` (optional): Search in username, email, fullName

**Request Headers:**
```
Authorization: Bearer <jwt_token>
```

**Success Response (200 OK):**
```json
{
  "data": {
    "users": [
      {
        "id": "user:johndoe",
        "email": "user@example.com",
        "username": "johndoe",
        "fullName": "John Doe",
        "role": "viewer",
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  },
  "metadata": {
    "page": 1,
    "limit": 20,
    "total": 50,
    "totalPages": 3
  }
}
```

#### Update User
Update a user's information (admin/editor only).

**Endpoint:** `PATCH /users/:username`

**Authentication Required:** Yes
**Required Role:** admin for role updates, admin/editor for other updates

**URL Parameters:**
- `username`: The username of the user to update

**Request Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Request Body (all fields optional):**
```json
{
  "email": "newemail@example.com",
  "password": "NewStrongP@ss123",
  "fullName": "John Smith",
  "role": "editor"
}
```

**Validation Rules:**
Same as signup endpoint for each field

**Success Response (200 OK):**
```json
{
  "data": {
    "user": {
      "id": "user:johndoe",
      "email": "newemail@example.com",
      "username": "johndoe",
      "fullName": "John Smith",
      "role": "editor",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

**Error Responses:**
- `403 Forbidden` (Role update by non-admin):
  ```json
  {
    "error": {
      "code": "AUTHORIZATION_ERROR",
      "message": "Only admins can update user roles"
    }
  }
  ```

#### Delete User
Delete a user (admin only).

**Endpoint:** `DELETE /users/:username`

**Authentication Required:** Yes
**Required Role:** admin

**URL Parameters:**
- `username`: The username of the user to delete

**Request Headers:**
```
Authorization: Bearer <jwt_token>
```

**Success Response (200 OK):**
```json
{
  "data": {
    "message": "User deleted successfully"
  }
}
```

#### Validate Username
Check if a username is available.

**Endpoint:** `GET /users/validate/:username`

**Rate Limit:** 20 requests per minute

**URL Parameters:**
- `username`: The username to check

**Success Response (200 OK):**
```json
{
  "data": {
    "available": true
  }
}
```

## Data Models

### User Object
```typescript
{
  id: string;          // Format: "user:{username}"
  email: string;       // Unique email address
  username: string;    // Unique username
  fullName?: string;   // Optional full name
  role: "admin" | "editor" | "viewer";
  createdAt: string;   // ISO 8601 date
  updatedAt: string;   // ISO 8601 date
}
```

## Examples

### Complete Signup Flow
1. Validate username:
```bash
curl -X GET "http://localhost:3001/api/users/validate/johndoe"
```

2. Create account:
```bash
curl -X POST "http://localhost:3001/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "StrongP@ss123",
    "username": "johndoe",
    "fullName": "John Doe"
  }'
```

3. Login:
```bash
curl -X POST "http://localhost:3001/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "StrongP@ss123"
  }'
```

### User Management Examples

#### Get User Profile
```bash
curl -X GET "http://localhost:3001/api/users/" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

#### Update User
```bash
curl -X PATCH "http://localhost:3001/api/users/johndoe" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "John Smith",
    "email": "john.smith@example.com"
  }'
```

#### List Users with Filtering
```bash
curl -X GET "http://localhost:3001/api/users/all?page=1&limit=20&role=editor&sort=createdAt&order=desc" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
``` 