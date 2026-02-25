#!/bin/bash
# verify-deployment.sh
# Verify that all services are running correctly

set -e

NAMESPACE=${1:-web3games-dev}

echo "🔍 Verifying deployment in namespace: ${NAMESPACE}"
echo ""

# Check namespace exists
if ! kubectl get namespace ${NAMESPACE} &>/dev/null; then
    echo "❌ Namespace ${NAMESPACE} does not exist!"
    exit 1
fi

echo "✅ Namespace exists"
echo ""

# Check deployments
echo "📦 Checking Deployments..."
kubectl get deployments -n ${NAMESPACE}
echo ""

# Check if deployments are ready
DEPLOYMENTS=("backend" "frontend" "hardhat")
for deployment in "${DEPLOYMENTS[@]}"; do
    echo "Checking ${deployment}..."
    if kubectl rollout status deployment/${deployment} -n ${NAMESPACE} --timeout=30s &>/dev/null; then
        echo "✅ ${deployment} is ready"
    else
        echo "⚠️  ${deployment} is not ready yet"
    fi
done
echo ""

# Check StatefulSet (MongoDB)
echo "📦 Checking StatefulSets..."
kubectl get statefulsets -n ${NAMESPACE}
echo ""

if kubectl rollout status statefulset/mongodb -n ${NAMESPACE} --timeout=30s &>/dev/null; then
    echo "✅ MongoDB is ready"
else
    echo "⚠️  MongoDB is not ready yet"
fi
echo ""

# Check pods
echo "🎯 Checking Pods..."
kubectl get pods -n ${NAMESPACE}
echo ""

# Check services
echo "🌐 Checking Services..."
kubectl get services -n ${NAMESPACE}
echo ""

# Check PVCs
echo "💾 Checking Persistent Volume Claims..."
kubectl get pvc -n ${NAMESPACE}
echo ""

# Check ingress
echo "🚪 Checking Ingress..."
kubectl get ingress -n ${NAMESPACE}
echo ""

# Check for failed pods
FAILED_PODS=$(kubectl get pods -n ${NAMESPACE} --field-selector=status.phase!=Running,status.phase!=Succeeded -o json | jq -r '.items[].metadata.name' 2>/dev/null || echo "")

if [ -n "$FAILED_PODS" ]; then
    echo "⚠️  Some pods are not in Running/Succeeded state:"
    echo "$FAILED_PODS"
    echo ""
    echo "💡 Tip: Check logs with: kubectl logs -n ${NAMESPACE} <pod-name>"
else
    echo "✅ All pods are running or completed successfully"
fi
echo ""

# Test backend endpoint
echo "🧪 Testing Backend endpoint..."
BACKEND_POD=$(kubectl get pods -n ${NAMESPACE} -l app=backend -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -n "$BACKEND_POD" ]; then
    if kubectl exec -n ${NAMESPACE} ${BACKEND_POD} -- wget -qO- http://localhost:4000/ &>/dev/null; then
        echo "✅ Backend is responding"
    else
        echo "⚠️  Backend is not responding"
    fi
else
    echo "⚠️  No backend pod found"
fi
echo ""

# Test frontend endpoint
echo "🧪 Testing Frontend endpoint..."
FRONTEND_POD=$(kubectl get pods -n ${NAMESPACE} -l app=frontend -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -n "$FRONTEND_POD" ]; then
    if kubectl exec -n ${NAMESPACE} ${FRONTEND_POD} -- sh -c "nc -z localhost 3000" &>/dev/null; then
        echo "✅ Frontend is listening on port 3000"
    else
        echo "⚠️  Frontend is not listening"
    fi
else
    echo "⚠️  No frontend pod found"
fi
echo ""

# Check contract deployment job
echo "🔨 Checking Contract Deployment..."
LATEST_JOB=$(kubectl get jobs -n ${NAMESPACE} -l app=hardhat-deployer --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null || echo "")
if [ -n "$LATEST_JOB" ]; then
    JOB_STATUS=$(kubectl get job -n ${NAMESPACE} ${LATEST_JOB} -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null || echo "")
    if [ "$JOB_STATUS" = "True" ]; then
        echo "✅ Latest contract deployment job (${LATEST_JOB}) completed successfully"
    else
        echo "⚠️  Latest contract deployment job (${LATEST_JOB}) has not completed yet"
        echo "💡 Tip: Check logs with: kubectl logs -n ${NAMESPACE} job/${LATEST_JOB}"
    fi
else
    echo "⚠️  No contract deployment job found"
    echo "💡 Tip: Run contract deployment with: ./scripts/deploy-contracts.sh ${NAMESPACE}"
fi
echo ""

echo "🎉 Verification complete!"
echo ""
echo "📝 Access the application:"
echo "   Frontend: http://<node-ip>:30002"
echo "   Backend:  http://<node-ip>:30004"
echo "   Hardhat:  http://<node-ip>:30545"
