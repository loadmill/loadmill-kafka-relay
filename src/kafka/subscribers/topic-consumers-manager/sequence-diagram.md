```mermaid
sequenceDiagram
  participant U as User
  participant API as Relay API (Fastify)
  participant RSM as RedisSubscribersManager
  participant RS as RedisSubscriber (per subscription id)
  participant TCM as TopicConsumersManager
  participant REDIS as Redis
  participant K as Kafka

  U->>API: POST /subscribe {topic, brokers, ...}
  API->>RSM: addSubscriber(...)
  RSM->>REDIS: SET kafka-relay:<instance>:subscribers:<id> (EX=600)
  RSM->>RS: return subscriber {id, topic, timeOfSubscription}

  API->>RS: subscriber.subscribe(timestamp?)
  RS->>TCM: ensureTopicConsumerRunning(topic, brokers, opts)

  TCM->>REDIS: SET kafka-relay:topics:<topic>:leader = <instanceId> (NX, EX=30)
  alt Lock acquired (this instance is leader)
    TCM->>K: start 1 Kafka consumer (groupId=hash(topic))
    loop each Kafka message
      K-->>TCM: message
      TCM->>REDIS: RPUSH kafka-relay:topics:<topic>:messages
      TCM->>REDIS: LTRIM keep last 5000
      TCM->>REDIS: EXPIRE messages key (600s)
    end
    loop every 10s
      TCM->>REDIS: EXPIRE leader lock (30s)
      alt Lost leadership
        TCM->>K: disconnect consumer
      end
    end
  else Lock not acquired (another instance is leader)
    TCM-->>RS: return (no Kafka consumer started here)
  end

  U->>API: GET /consume/:id
  API->>RSM: getMessages(id)
  RSM->>REDIS: GET subscriber metadata (find id across instances)
  RSM->>TCM: ensureTopicConsumerRunning(topic, brokers, opts) (best-effort)
  RSM->>REDIS: LRANGE kafka-relay:topics:<topic>:messages 0 -1
  RSM-->>API: filter messages where timestamp >= timeOfSubscription
  API-->>U: { messages }
```

```mermaid
flowchart TB
  subgraph Subscriber_Metadata["Subscriber metadata (per subscriber id)"]
    SKEY["kafka-relay:<instanceId>:subscribers:<subscriberId>\nvalue: {id, instanceId, kafkaConfig, timeOfSubscription, topic}\nTTL: 600s"]
  end

  subgraph Topic_Shared["Topic shared storage (per topic)"]
    LKEY["kafka-relay:topics:<topic>:leader\nvalue: <instanceId>\nTTL: 30s (renewed)"]
    MKEY["kafka-relay:topics:<topic>:messages\nRedis LIST of JSON messages\nTTL: 600s\nLength bounded: last 5000"]
  end

  SKEY -->|"contains topic"| MKEY
  LKEY -->|"decides who writes"| MKEY
```

``````mermaid
flowchart LR
  subgraph Redis
    LOCK["topic leader lock"]
    LIST["topic messages list"]
  end

  subgraph InstanceA["Relay instance A"]
    A["Topic consumer (only if leader)"]
  end

  subgraph InstanceB["Relay instance B"]
    B["Topic consumer (only if leader)"]
  end

  A --> LOCK
  B --> LOCK

  A -->|"if leader"| LIST
  B -->|"if leader"| LIST
```