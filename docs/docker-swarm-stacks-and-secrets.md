# Docker Swarm: Stacks & Secrets

A reference guide for deploying multi-service applications on Docker Swarm using Stacks and managing sensitive data with Secrets.

---

## Table of Contents

1. [Stacks Overview](#stacks-overview)
2. [Stack Compose Files](#stack-compose-files)
3. [The `deploy` Key](#the-deploy-key)
4. [Stack Commands](#stack-commands)
5. [Updating a Stack](#updating-a-stack)
6. [Stacks vs Docker Compose](#stacks-vs-docker-compose)
7. [Secrets Overview](#secrets-overview)
8. [How Secrets Work Under the Hood](#how-secrets-work-under-the-hood)
9. [Secret Commands](#secret-commands)
10. [Using Secrets in Services and Stacks](#using-secrets-in-services-and-stacks)
11. [Secret Rotation](#secret-rotation)
12. [Secrets in Local Development](#secrets-in-local-development)
13. [Best Practices](#best-practices)
14. [Complete Example: Voting App Stack with Secrets](#complete-example-voting-app-stack-with-secrets)

---

## Stacks Overview

A **Stack** is a group of interrelated services, networks, and volumes that are deployed and managed together as a single unit on a Docker Swarm. Introduced in Docker 1.13, stacks bring the same declarative approach of Compose files to production Swarm clusters.

**Key concepts:**

- A stack accepts a **Compose file** (version 3+) as its input.
- The Compose file is a **declarative definition** - you state the desired end state and Swarm figures out how to achieve it.
- A stack manages **services**, **overlay networks**, **volumes**, **configs**, and **secrets** together.
- You deploy with `docker stack deploy` - no need for the `docker-compose` CLI on your production servers.
- Swarm creates everything for you (networks, volumes, etc.), or you can reference pre-existing resources with `external: true`.

### How It Fits Together

```
Stack (Compose YAML file)
├── Service A (N replicas)
│   └── Task → Container on Node X
│   └── Task → Container on Node Y
├── Service B (M replicas)
│   └── Task → Container on Node Z
├── Overlay Network (frontend)
├── Overlay Network (backend)
├── Volume (db-data)
└── Secrets (db_password, api_key)
```

Each service creates tasks, which the Swarm orchestrator assigns to nodes. Those tasks produce containers. The stack name is **prepended to all resources** it creates (e.g., stack `myapp` creates service `myapp_web`, network `myapp_frontend`, etc.).

---

## Stack Compose Files

Stacks require Compose file format **version 3.0 or higher**. The file looks nearly identical to a standard Compose file, with the addition of the `deploy` key for Swarm-specific settings.

### Minimal Example

```yaml
version: "3.8"

services:
  web:
    image: nginx:alpine
    ports:
      - "80:80"
    deploy:
      replicas: 3
    networks:
      - frontend

  api:
    image: myregistry/api:latest
    deploy:
      replicas: 2
    networks:
      - frontend
      - backend

  db:
    image: postgres:15
    volumes:
      - db-data:/var/lib/postgresql/data
    deploy:
      placement:
        constraints:
          - node.role == manager
    networks:
      - backend

networks:
  frontend:
  backend:

volumes:
  db-data:
```

### What Swarm Ignores

When deploying as a stack, Swarm **ignores** several Compose directives that only apply to local development:

| Ignored by Swarm | Why |
|---|---|
| `build` | Building should happen in CI/CD, not on production nodes |
| `container_name` | Swarm manages naming via service name + replica slot |
| `depends_on` | Swarm doesn't enforce startup order; use health checks instead |
| `restart` | Replaced by `deploy.restart_policy` |
| `network_mode`, `links` | Not applicable in Swarm overlay networking |

---

## The `deploy` Key

The `deploy` section is **only honored by `docker stack deploy`** and is the heart of Swarm-specific configuration.

### Replicas and Mode

```yaml
deploy:
  mode: replicated    # default - run N copies
  replicas: 5
```

Or run exactly one instance per node:

```yaml
deploy:
  mode: global        # one per node, replicas is ignored
```

### Update Configuration

Controls rolling updates when you re-deploy a stack with changes:

```yaml
deploy:
  update_config:
    parallelism: 2          # Update 2 tasks at a time (0 = all at once)
    delay: 10s              # Wait between updating each group
    failure_action: rollback  # On failure: pause | continue | rollback
    monitor: 60s            # Time to watch for failure after update
    max_failure_ratio: 0.1  # Tolerate up to 10% failures
    order: start-first      # start-first (zero downtime) or stop-first (default)
```

**`order` explained:**
- `stop-first` (default): Stop old task, then start new one. Brief downtime but uses fewer resources.
- `start-first`: Start new task, then stop old one. Zero downtime but temporarily runs extra containers.

### Restart Policy

What happens when a container exits:

```yaml
deploy:
  restart_policy:
    condition: on-failure   # none | on-failure | any (default)
    delay: 5s               # Time between restart attempts
    max_attempts: 3         # Max restarts before giving up
    window: 120s            # Time window to evaluate restart success
```

### Placement Constraints

Control **which nodes** a service can run on:

```yaml
deploy:
  placement:
    constraints:
      - node.role == manager          # Only on manager nodes
      - node.labels.region == us-east # Custom node label
      - node.hostname == prod-01      # Specific node
    preferences:
      - spread: node.labels.zone      # Spread evenly across zones
    max_replicas_per_node: 2          # Cap replicas per node
```

You label nodes with:
```bash
docker node update --label-add region=us-east node-01
```

### Resource Limits

```yaml
deploy:
  resources:
    limits:
      cpus: "0.50"
      memory: 512M
    reservations:
      cpus: "0.25"
      memory: 256M
```

Reservations are guaranteed minimums the scheduler uses for placement decisions. Limits are hard ceilings.

### Labels

Labels on the **service** (not the containers):

```yaml
deploy:
  labels:
    com.example.team: "platform"
    com.example.environment: "production"
```

---

## Stack Commands

### Deploy a Stack

```bash
docker stack deploy -c docker-compose.yml myapp
```

Key flags:

| Flag | Purpose |
|---|---|
| `-c, --compose-file` | Path to Compose file(s) |
| `--prune` | Remove services no longer in the file |
| `--with-registry-auth` | Forward registry credentials to swarm nodes |
| `--resolve-image always` | Ensure all nodes pull the exact same image digest |

### List Stacks

```bash
$ docker stack ls
NAME      SERVICES   ORCHESTRATOR
myapp     3          Swarm
```

### List Services in a Stack

```bash
$ docker stack services myapp
ID             NAME        MODE         REPLICAS   IMAGE               PORTS
abc123def456   myapp_web   replicated   3/3        nginx:alpine        *:80->80/tcp
def456ghi789   myapp_api   replicated   2/2        myregistry/api:latest
ghi789jkl012   myapp_db    replicated   1/1        postgres:15
```

The `REPLICAS` column shows `running/desired` - useful for quickly seeing if all containers are healthy.

### List Tasks (Containers) in a Stack

```bash
$ docker stack ps myapp
ID             NAME          IMAGE            NODE        DESIRED STATE   CURRENT STATE
a1b2c3d4e5f6   myapp_web.1   nginx:alpine     node-01     Running         Running 2 hours ago
b2c3d4e5f6g7   myapp_web.2   nginx:alpine     node-02     Running         Running 2 hours ago
...
```

Filter out old/failed tasks:
```bash
docker stack ps myapp --filter desired-state=running
```

### Remove a Stack

```bash
docker stack rm myapp
```

This removes all services, networks, and secrets associated with the stack. **Volumes are NOT removed** (to prevent data loss).

---

## Updating a Stack

To update a running stack, **edit your Compose file and re-deploy with the same stack name**:

```bash
# Change replicas from 3 to 5 in docker-compose.yml, then:
docker stack deploy -c docker-compose.yml myapp
```

There is no separate `docker stack update` command. The `deploy` command performs a **reconciliation**:

1. **New services** are created.
2. **Changed services** receive rolling updates (following `update_config`).
3. **Removed services** keep running unless you use `--prune`.
4. **Networks and volumes** are created if new; existing ones are untouched.

### Anti-pattern: Manual Service Updates

Avoid running `docker service update` directly on services managed by a stack. The next `docker stack deploy` will overwrite those changes. **The Compose file should be the single source of truth**, ideally stored in version control.

---

## Stacks vs Docker Compose

Both tools use the same Compose file format, but they target different environments:

| Feature | `docker compose up` | `docker stack deploy` |
|---|---|---|
| Target | Single host (development) | Swarm cluster (production) |
| `build` | Honored | Ignored |
| `deploy` | Ignored | Honored |
| `restart` | Honored | Ignored (use `deploy.restart_policy`) |
| `depends_on` | Honored | Ignored |
| Networking | Bridge (single host) | Overlay (multi-host) |
| Load balancing | None built-in | Ingress routing mesh |
| Secrets | File-based (not encrypted) | Encrypted Swarm secrets |

**They get along.** You can use a single Compose file for both:
- `docker compose up` ignores `deploy` settings and warns you about them.
- `docker stack deploy` ignores `build` directives and warns you about them.

### Multi-File Strategy

For more separation, use override files:

```bash
# Development
docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# Production
docker stack deploy -c docker-compose.yml -c docker-compose.prod.yml myapp
```

---

## Secrets Overview

Docker Swarm Secrets provide **built-in, encrypted storage** for sensitive data. Introduced in Docker 1.13.1, they are the easiest secure solution for handling credentials in Swarm.

**What qualifies as a secret:**
- Database passwords
- API keys (Twitter, AWS, Stripe, etc.)
- TLS certificates and private keys
- SSH keys
- Any string or binary up to **500 KB**

**Why use Swarm Secrets:**
- Encrypted at rest and in transit, out of the box.
- No external infrastructure required (unlike Vault, etc.).
- Applications don't need to be rewritten - secrets appear as files at `/run/secrets/`.
- Secrets are only delivered to nodes that need them.

---

## How Secrets Work Under the Hood

### Storage (At Rest)

Secrets are stored in the **encrypted Raft database** on manager nodes:

- Encrypted with AES-256-GCM.
- Replicated across all manager nodes via the Raft consensus protocol.
- **Never written to disk on worker nodes.**

For additional security, enable **autolock**:

```bash
# On swarm init
docker swarm init --autolock

# Or on an existing swarm
docker swarm update --autolock
```

With autolock, restarted manager nodes require an unlock key before they can rejoin the cluster and access the Raft log.

### Transit (In Motion)

Secrets travel from managers to workers over the **TLS-encrypted control plane**:

- All node-to-node communication uses mutual TLS (mTLS).
- Certificates are automatically rotated (default: 90 days).
- Secrets are only sent to nodes running services that need them.

### Delivery (In Containers)

Inside a container, secrets appear as files in an **in-memory tmpfs** filesystem:

```
/run/secrets/
├── db_password        # contains the password value
├── api_key            # contains the API key value
└── tls_cert           # contains the certificate
```

- **Never written to disk** - the tmpfs is RAM-backed.
- When the container stops, the tmpfs is torn down and the secret is gone from that node.
- Default permissions: `0444`, owned by `root`.

Think of it as a key-value store: the **filename** is the key, the **file content** is the value.

---

## Secret Commands

### Create a Secret

```bash
# From stdin (preferred - avoids writing to disk)
printf "supersecretpassword" | docker secret create db_password -

# From a file
docker secret create tls_cert ./cert.pem
rm ./cert.pem  # delete the plaintext file immediately

# With labels
echo "myapikey" | docker secret create --label env=production api_key -
```

### List Secrets

```bash
$ docker secret ls
ID                          NAME           CREATED          UPDATED
qdz8k5a1b2c3d4e5f6g7h8i9   db_password    2 minutes ago    2 minutes ago
a9r3j7k8l9m0n1o2p3q4r5s6   api_key        30 seconds ago   30 seconds ago
```

### Inspect a Secret

Shows metadata only - **never reveals the value** (by design):

```bash
docker secret inspect db_password
docker secret inspect --pretty db_password
```

### Remove a Secret

```bash
docker secret rm db_password
```

Fails if the secret is currently assigned to a running service.

---

## Using Secrets in Services and Stacks

### With `docker service create`

```bash
# Basic assignment
docker service create \
  --name web \
  --secret db_password \
  nginx:latest

# Custom target name, ownership, and permissions
docker service create \
  --name web \
  --secret source=db_password,target=database_pass,uid=1000,gid=1000,mode=0400 \
  nginx:latest
```

The secret appears at `/run/secrets/database_pass` with owner `1000:1000` and mode `0400`.

### Adding/Removing from Running Services

```bash
# Add (triggers rolling restart)
docker service update --secret-add new_secret web

# Remove (triggers rolling restart)
docker service update --secret-rm old_secret web
```

### In Stack Compose Files

Secrets are declared at two levels: **top-level** (defines them) and **service-level** (grants access).

```yaml
version: "3.8"

services:
  web:
    image: myapp:latest
    secrets:
      - db_password           # short syntax
      - source: api_key       # long syntax with custom options
        target: app_api_key
        uid: "1000"
        gid: "1000"
        mode: 0400

  db:
    image: postgres:15
    secrets:
      - db_password
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password  # _FILE convention

secrets:
  db_password:
    external: true            # already exists in the swarm
  api_key:
    file: ./secrets/api.txt   # created from a local file at deploy time
```

Many official images (PostgreSQL, MySQL, MariaDB) support the `_FILE` environment variable convention, which reads the password from a file path rather than an environment variable directly.

---

## Secret Rotation

Secrets are **immutable** - you cannot update a secret's value in place. Instead, use versioned names:

```bash
# 1. Create the new version
printf "new_password" | docker secret create db_password_v2 -

# 2. Update the service (swap old for new, keep the same target)
docker service update \
  --secret-rm db_password_v1 \
  --secret-add source=db_password_v2,target=db_password \
  web

# 3. Remove the old version once everything is healthy
docker secret rm db_password_v1
```

### Rotation in Stack Files

```yaml
secrets:
  db_password:
    external: true
    name: db_password_v2   # point to the new version in the swarm
```

The `target` in the service stays the same, so **application code doesn't change** - only the underlying secret version is swapped.

---

## Secrets in Local Development

When using `docker compose` (without Swarm), secrets still work but with reduced security:

```yaml
secrets:
  db_password:
    file: ./secrets/db_password.txt  # must use file-based locally
```

What happens:
- Compose **bind-mounts** the file into the container at `/run/secrets/db_password`.
- There is **no encryption** - the file sits on disk in plaintext.
- `external: true` is **not supported** outside Swarm.

This provides **API compatibility** between dev and prod: your app reads from `/run/secrets/` in both environments, but only Swarm provides the encryption layer.

---

## Best Practices

### Stacks

1. **Use explicit image tags** (e.g., `myapp:2.1.0`), never `latest` in production.
2. **Store Compose files in version control** - they are your source of truth.
3. **Use `--prune`** when deploying to remove services deleted from the file.
4. **Use `--with-registry-auth`** for private registries.
5. **Set `order: start-first`** for zero-downtime updates on stateless services.
6. **Set `failure_action: rollback`** so failed updates revert automatically.
7. **Define health checks** so Swarm can detect and replace unhealthy containers.
8. **Pin stateful services** to specific nodes with placement constraints.
9. **Use `internal: true`** on backend networks that shouldn't be externally reachable.
10. **Use `encrypted: true`** on overlay networks carrying sensitive data.

### Secrets

1. **Pipe from stdin** rather than writing to files on disk.
2. **Never store secrets in images, Dockerfiles, or environment variables.**
3. **Grant secrets only to services that need them** (least privilege).
4. **Set restrictive permissions** (`mode: 0400`) and appropriate `uid`/`gid`.
5. **Use versioned names** (`_v1`, `_v2`) for rotation.
6. **Enable autolock** on the swarm to protect encryption keys at rest.
7. **Remove old secret versions** after successful rotation.
8. **Keep secret files out of version control** (`.gitignore`).
9. **Design apps to read from `/run/secrets/`** using the `_FILE` convention.
10. **Never log secret values** in application code.

### Swarm Hardening

- Run **3 or 5 manager nodes** (odd number for Raft quorum).
- Run workloads on **worker nodes**, not managers (`node.role == worker`).
- **Reduce TLS cert rotation** for tighter security: `docker swarm update --cert-expiry 24h`.
- Store the **autolock key** in a separate secure location (not on the swarm itself).

---

## Complete Example: Voting App Stack with Secrets

This example deploys a multi-service voting application with secrets, overlay networks, placement constraints, and rolling update configuration.

```yaml
version: "3.8"

services:
  redis:
    image: redis:alpine
    networks:
      - frontend
    deploy:
      replicas: 2
      update_config:
        parallelism: 1
        delay: 10s
      restart_policy:
        condition: on-failure

  db:
    image: postgres:15
    volumes:
      - db-data:/var/lib/postgresql/data
    networks:
      - backend
    secrets:
      - db_password
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    deploy:
      placement:
        constraints:
          - node.role == manager
      restart_policy:
        condition: on-failure
        max_attempts: 3
        window: 120s

  vote:
    image: myregistry/vote:latest
    ports:
      - "5000:80"
    networks:
      - frontend
    deploy:
      replicas: 5
      update_config:
        parallelism: 2
        delay: 10s
        order: start-first
        failure_action: rollback
      restart_policy:
        condition: on-failure

  result:
    image: myregistry/result:latest
    ports:
      - "5001:80"
    networks:
      - backend
    deploy:
      replicas: 2
      update_config:
        parallelism: 1
        delay: 5s
      restart_policy:
        condition: on-failure

  worker:
    image: myregistry/worker:latest
    networks:
      - frontend
      - backend
    secrets:
      - db_password
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
        window: 120s
      labels:
        app.component: "worker"

  visualizer:
    image: dockersamples/visualizer:stable
    ports:
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    deploy:
      placement:
        constraints:
          - node.role == manager

networks:
  frontend:
    driver: overlay
  backend:
    driver: overlay
    internal: true

volumes:
  db-data:

secrets:
  db_password:
    external: true
```

### Deploying

```bash
# 1. Initialize swarm (if not already)
docker swarm init

# 2. Create the secret
printf "my_db_password_here" | docker secret create db_password -

# 3. Deploy the stack
docker stack deploy -c docker-compose.yml voteapp

# 4. Check status
docker stack ls
docker stack services voteapp
docker stack ps voteapp --filter desired-state=running

# 5. Update (edit the file, then re-deploy)
docker stack deploy -c docker-compose.yml voteapp

# 6. Tear down
docker stack rm voteapp
```

### Accessing the App

| Service | URL | Purpose |
|---|---|---|
| Vote | `http://<any-node>:5000` | Cast votes |
| Result | `http://<any-node>:5001` | View results |
| Visualizer | `http://<any-node>:8080` | See container distribution across nodes |

The Swarm **ingress routing mesh** means you can access published ports on **any node** in the cluster, even if the container isn't running on that node.

---

## Quick Reference

```bash
# --- Stacks ---
docker stack deploy -c compose.yml STACK    # Deploy or update
docker stack ls                              # List all stacks
docker stack services STACK                  # List services + replica status
docker stack ps STACK                        # List tasks + node placement
docker stack rm STACK                        # Remove (keeps volumes)

# --- Secrets ---
printf "value" | docker secret create NAME -  # Create from stdin
docker secret create NAME ./file.txt          # Create from file
docker secret ls                              # List secrets
docker secret inspect NAME                    # Metadata (not the value)
docker secret rm NAME                         # Remove (must be unassigned)

# --- Swarm ---
docker swarm init                             # Initialize swarm
docker swarm init --autolock                  # With encryption key protection
docker node ls                                # List nodes
docker node update --label-add key=val NODE   # Add labels for constraints
docker service logs STACK_SERVICE --follow    # Tail service logs
docker service rollback STACK_SERVICE         # Roll back a service update
```
