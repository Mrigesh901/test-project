#!/bin/bash
# deploy-contracts.sh
# Manually trigger smart contract deployment by creating a new Job

set -e

NAMESPACE=${1:-web3games-dev}
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
JOB_NAME="hardhat-deployer-${TIMESTAMP}"

echo "🚀 Triggering contract deployment in namespace: ${NAMESPACE}"

# Delete old completed jobs to avoid clutter
echo "🧹 Cleaning up old deployer jobs..."
kubectl delete job -n ${NAMESPACE} -l app=hardhat-deployer --field-selector status.successful=1 2>/dev/null || true

# Create a new job with timestamp
echo "📝 Creating new deployment job: ${JOB_NAME}"
cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB_NAME}
  namespace: ${NAMESPACE}
  labels:
    app: hardhat-deployer
spec:
  backoffLimit: 2
  ttlSecondsAfterFinished: 3600
  template:
    metadata:
      labels:
        app: hardhat-deployer
    spec:
      restartPolicy: Never
      initContainers:
      - name: wait-for-hardhat
        image: busybox:1.36
        command:
        - sh
        - -c
        - |
          echo "Waiting for Hardhat node to be ready..."
          until nc -z hardhat 8545; do
            echo "Hardhat not ready yet, waiting..."
            sleep 5
          done
          echo "Hardhat node is ready!"
          sleep 10
      containers:
      - name: deployer
        image: ghcr.io/\$(echo \${GITHUB_REPOSITORY_OWNER} | tr '[:upper:]' '[:lower:]')/test-project-hardhat:latest-dev
        imagePullPolicy: Always
        command:
        - sh
        - -c
        - |
          echo "Starting contract deployment..."
          ./node_modules/.bin/hardhat run scripts/deploy/deploy.js --network localhost
          echo "Deployment complete!"
        env:
        - name: HARDHAT_NETWORK_URL
          value: "http://hardhat:8545"
        volumeMounts:
        - name: artifacts
          mountPath: /app/artifacts
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
      volumes:
      - name: artifacts
        persistentVolumeClaim:
          claimName: hardhat-artifacts
      imagePullSecrets:
      - name: ghcr-secret
EOF

echo "⏳ Waiting for job to complete..."
kubectl wait --for=condition=complete --timeout=5m job/${JOB_NAME} -n ${NAMESPACE}

echo "✅ Contract deployment completed successfully!"
echo "📋 View logs with: kubectl logs -n ${NAMESPACE} job/${JOB_NAME}"
