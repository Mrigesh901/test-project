#!/bin/bash
# deploy.sh
# Quick deployment script for GitOps setup

set -e

ENVIRONMENT=${1:-dev}
NAMESPACE="web3games-${ENVIRONMENT}"

echo "🚀 Deploying Web3Games to ${ENVIRONMENT} environment"
echo "📦 Namespace: ${NAMESPACE}"
echo ""

# Verify kubectl is configured
if ! kubectl cluster-info &>/dev/null; then
    echo "❌ kubectl is not configured correctly"
    echo "💡 Ensure you have access to the cluster"
    exit 1
fi

echo "✅ kubectl is configured"
echo ""

# Create namespace if it doesn't exist
echo "📝 Creating namespace..."
kubectl create namespace ${NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -
echo ""

# Apply base + environment overlay using kustomize
echo "🔧 Applying Kubernetes manifests using kustomize..."
kubectl apply -k k8s/${ENVIRONMENT} -n ${NAMESPACE}
echo ""

# Wait for deployments to be ready
echo "⏳ Waiting for deployments to be ready..."
echo ""

# Wait for MongoDB
echo "Waiting for MongoDB..."
kubectl rollout status statefulset/mongodb -n ${NAMESPACE} --timeout=5m
echo "✅ MongoDB is ready"
echo ""

# Wait for Hardhat
echo "Waiting for Hardhat node..."
kubectl rollout status deployment/hardhat -n ${NAMESPACE} --timeout=5m
echo "✅ Hardhat node is ready"
echo ""

# Deploy contracts
echo "📝 Deploying smart contracts..."
if [ -f "./scripts/deploy-contracts.sh" ]; then
    bash ./scripts/deploy-contracts.sh ${NAMESPACE}
else
    echo "⚠️  Contract deployment script not found, skipping..."
fi
echo ""

# Wait for Backend
echo "Waiting for Backend..."
kubectl rollout status deployment/backend -n ${NAMESPACE} --timeout=5m
echo "✅ Backend is ready"
echo ""

# Wait for Frontend
echo "Waiting for Frontend..."
kubectl rollout status deployment/frontend -n ${NAMESPACE} --timeout=5m
echo "✅ Frontend is ready"
echo ""

echo "🎉 Deployment complete!"
echo ""
echo "📝 Summary:"
kubectl get all -n ${NAMESPACE}
echo ""

echo "🌐 Access the application:"
if [ "$ENVIRONMENT" = "dev" ]; then
    NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
    echo "   Frontend: http://${NODE_IP}:30002"
    echo "   Backend:  http://${NODE_IP}:30004"
    echo "   Hardhat:  http://${NODE_IP}:30545"
else
    echo "   Check ingress configuration: kubectl get ingress -n ${NAMESPACE}"
fi
echo ""

echo "💡 Useful commands:"
echo "   View pods:       kubectl get pods -n ${NAMESPACE}"
echo "   View logs:       kubectl logs -n ${NAMESPACE} -l app=<service>"
echo "   Port forward:    kubectl port-forward -n ${NAMESPACE} svc/frontend 3000:3000"
echo "   Verify:          ./scripts/verify-deployment.sh ${NAMESPACE}"
