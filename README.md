# TrifectaJS

TrifectaJS is a TypeScript library inspired by the Solid Trifecta concept, adapted for the modern JavaScript ecosystem. It offers an integrated solution for three fundamental pillars of web development:
- **Cache**: Efficient temporary data storage to reduce latency and server load.
- **Real-Time Communication**: WebSocket support for instant updates between client and server.
- **Task Queues**: Asynchronous background job processing for time-consuming operations.

The key advantage of TrifectaJS is that you don't need multiple tools like Redis, MemCache, RabbitMQ, or Supabase Realtime - just your good old relational database. While TrifectaJS works with any PostgreSQL database, we recommend Neon's platform as a powerful complement, isolating processing in a separate branch with autoscaling capabilities. This provides an all-in-one solution without the complexity of managing multiple infrastructure components, but you're free to use your preferred PostgreSQL provider.


## Prerequisites
- Node.js 18+ or Bun 1.0+
- A PostgreSQL database (preferably [Neon](https://neon.tech))

## Installation
```bash
# Using bun
bun add @trifecta-js/core @trifecta-js/cache @trifecta-js/cable @trifecta-js/queue
# Or using npm
npm install @trifecta-js/core @trifecta-js/cache @trifecta-js/cable @trifecta-js/queue
# CLI (optional)
bun add -g @trifecta-js/cli
```

## Basic Usage
### Cache
```typescript
import { TrifectaCache } from '@trifecta-js/cache';
const cache = new TrifectaCache({
  connectionString: 'postgresql://user:pass@trifecta-branch.neon.tech/db',
  encryption: { enabled: true, key: 'your-secret-key' },
});
// Store in cache for 1 hour
await cache.set('user:1', { id: 1, name: 'John', email: 'john@example.com' }, { ttl: 3600 });
// Retrieve from cache
const user = await cache.get('user:1');
console.log(user); // { id: 1, name: 'John', email: 'john@example.com' }
```

### Real-Time Communication
```typescript
import { TrifectaCable } from '@trifecta-js/cable';
const cable = new TrifectaCable({
  connectionString: 'postgresql://user:pass@trifecta-branch.neon.tech/db',
});
// Subscribe to a channel
cable.subscribe('chat:room1', (msg) => {
  console.log(`New message: ${msg.text}`);
});
// Send message
await cable.broadcast('chat:room1', { text: 'Hello, how are you?', sender: 'John' });
```

### Task Queues
```typescript
import { TrifectaQueue } from '@trifecta-js/queue';
const queue = new TrifectaQueue({
  connectionString: 'postgresql://user:pass@trifecta-branch.neon.tech/db',
});
// Add task
await queue.enqueue('sendEmail', { userId: 1, email: 'john@example.com' }, { queue: 'emails' });
// Worker to process
queue.process('emails', async (job) => {
  console.log(`Sending email to ${job.arguments.email}`);
  // Sending logic
});
```

## Configuration
Use the CLI to easily configure TrifectaJS with your database:
```bash
# Initialize infrastructure
trifecta init --api-key your-api-key --project-id your-neon-project
# Run migrations
trifecta migrate
```

## Examples
Check the `examples/` folder to see complete applications using TrifectaJS:
- `basic-cache`: Simple example of cache usage
- `chat-app`: Real-time chat application
- `background-jobs`: Background task processing

## License
[MIT](./LICENSE)
