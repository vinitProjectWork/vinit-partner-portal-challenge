const Redis = require('redis');

let redisClient;

async function initializeRedis() {
  try {
    // Default configuration if no REDIS_URI is provided
    const config = {
      socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: process.env.REDIS_PORT || 6379
      },
      // Add default authentication if not using URI
      username: process.env.REDIS_USERNAME || 'default',
      password: process.env.REDIS_PASSWORD || 'admin@123'
    };

    // If REDIS_URI is provided, use it instead (it can include auth)
    if (process.env.REDIS_URI) {
      config.url = process.env.REDIS_URI;
    }

    redisClient = Redis.createClient(config);

    // Handle Redis errors
    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    // Log successful connection
    redisClient.on('connect', () => {
      console.log('Redis Client Connected');
    });

    // Log ready state
    redisClient.on('ready', () => {
      console.log('Redis Client Ready');
    });

    await redisClient.connect();

    // Initialize Bloom filter for usernames if it doesn't exist
    try {
      await redisClient.sendCommand(['BF.RESERVE', 'usernames', '0.01', '10000']);
    } catch (error) {
      // Ignore error if filter already exists
      if (!error.message.includes('already exists')) {
        console.warn('Warning: Could not create Bloom filter:', error.message);
      }
    }

    return redisClient;
  } catch (error) {
    console.error('Redis initialization error:', error.message);
    throw error;
  }
}

async function getRedisClient() {
  if (!redisClient) {
    await initializeRedis();
  }
  return redisClient;
}

async function addToBloomFilter(username) {
  try {
    const client = await getRedisClient();
    return client.sendCommand(['BF.ADD', 'usernames', username]);
  } catch (error) {
    console.error('Error adding to Bloom filter:', error.message);
    return false;
  }
}

async function checkBloomFilter(username) {
  try {
    const client = await getRedisClient();
    const result = await client.sendCommand(['BF.EXISTS', 'usernames', username]);
    return result === 1;
  } catch (error) {
    console.error('Error checking Bloom filter:', error.message);
    return false;
  }
}

async function cacheSet(key, value, expireSeconds = 3600) {
  try {
    const client = await getRedisClient();
    await client.set(key, JSON.stringify(value), {
      EX: expireSeconds
    });
  } catch (error) {
    console.error('Error setting cache:', error.message);
  }
}

async function cacheGet(key) {
  try {
    const client = await getRedisClient();
    const value = await client.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error('Error getting from cache:', error.message);
    return null;
  }
}

async function cacheDelete(key) {
  try {
    const client = await getRedisClient();
    await client.del(key);
  } catch (error) {
    console.error('Error deleting from cache:', error.message);
  }
}

async function cacheDeletePattern(pattern) {
  try {
    const client = await getRedisClient();
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(keys);
    }
  } catch (error) {
    console.error('Error deleting pattern from cache:', error.message);
  }
}

// Cache keys
const CACHE_KEYS = {
  USER: (username) => `user:${username}`,
  ALL_USERS: 'all_users',
  USER_PREFIX: 'user:'
};

module.exports = {
  initializeRedis,
  getRedisClient,
  addToBloomFilter,
  checkBloomFilter,
  cacheSet,
  cacheGet,
  cacheDelete,
  cacheDeletePattern,
  CACHE_KEYS
}; 