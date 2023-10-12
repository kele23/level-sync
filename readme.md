# LEVEL SYNC

## Usage

```typescript
// create level-logged
const db = new LevelLogged(new Level()<string, any>('./db'));

// create a connection
const p2p = new Peer();
const connection = new P2PConnection(p2p);
p2p.on('connection', (dataConnection) => {
    connection.incomingConnection(dataConnection);
});

// connect connection & db with the sync manager
const sync = new SyncManager(db, connection);

// various sync
sync.doPull(); // pull from other db to mine
sync.doPush(); // push from my db to other
sync.doSync(); // pull and then push
sync.doSync(interval); // make a sync every <interval> seconds
sync.isScheduled(); // true if there is a sync scheduled
sync.stopSync();
```

## Types of connections

#### P2P Connection based on PeerJS

```typescript
const p2p = new Peer(); // PeerJS
const connection = new P2PConnection(p2p);
p2p.on('connection', (dataConnection) => {
    connection.incomingConnection(dataConnection);
});
```

#### Generic CLIENT-SERVER

Client

```typescript
const connection = new ClientConnection(async (data) => {
    return await axios.put(...
});
```

Server

```typescript
const connection = new ServerConnection();
server.onReceive(async (data) => {
    return await connection.incomingReceive(data);
});
```
