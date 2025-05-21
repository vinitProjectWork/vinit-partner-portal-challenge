const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { cacheSet, cacheGet, cacheDelete, CACHE_KEYS, addToBloomFilter } = require('../config/redis');

const ROLES = {
  ADMIN: 'admin',
  EDITOR: 'editor',
  VIEWER: 'viewer'
};

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    match: /^[a-zA-Z0-9_-]+$/
  },
  fullName: {
    type: String,
    default: ''
  },
  role: {
    type: String,
    enum: Object.values(ROLES),
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(Number(process.env.PASSWORD_SALT_ROUNDS) || 10);
    this.password = await bcrypt.hash(this.password, salt);
  }
  next();
});

// Cache operations after save
userSchema.post('save', async function() {
  // Add username to Bloom filter
  await addToBloomFilter(this.username);
  
  // Update user cache
  await cacheSet(CACHE_KEYS.USER(this.username), this.toJSON());
  
  // Invalidate all users cache
  await cacheDelete(CACHE_KEYS.ALL_USERS);
});

// Cache operations after update
userSchema.post('findOneAndUpdate', async function(doc) {
  if (doc) {
    await cacheSet(CACHE_KEYS.USER(doc.username), doc.toJSON());
    await cacheDelete(CACHE_KEYS.ALL_USERS);
  }
});

// Cache operations after delete
userSchema.post('findOneAndDelete', async function(doc) {
  if (doc) {
    await cacheDelete(CACHE_KEYS.USER(doc.username));
    await cacheDelete(CACHE_KEYS.ALL_USERS);
  }
});

// Remove password when converting to JSON
userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Static method to find by email (case insensitive) with cache
userSchema.statics.findByEmail = async function(email) {
  const users = await this.find();
  return users.find(user => user.email.toLowerCase() === email.toLowerCase());
};

// Static method to find by username with cache
userSchema.statics.findByUsername = async function(username) {
  // Try cache first
  const cached = await cacheGet(CACHE_KEYS.USER(username));
  if (cached) {
    return new this(cached);
  }

  // If not in cache, query database
  const user = await this.findOne({ username });
  if (user) {
    await cacheSet(CACHE_KEYS.USER(username), user.toJSON());
  }
  return user;
};

// Static method to find all with cache
userSchema.statics.findAllCached = async function() {
  // Try cache first
  const cached = await cacheGet(CACHE_KEYS.ALL_USERS);
  if (cached) {
    return cached.map(userData => new this(userData));
  }

  // If not in cache, query database
  const users = await this.find();
  const usersJSON = users.map(user => user.toJSON());
  await cacheSet(CACHE_KEYS.ALL_USERS, usersJSON);
  return users;
};

const User = mongoose.model('User', userSchema);

module.exports = {
  User,
  ROLES
}; 