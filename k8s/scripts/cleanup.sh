#!/bin/bash
# cleanup.sh
# Clean up Web3Games deployment

set -e

NAMESPACE=${1:-web3games-dev}
FORCE=${2:-false}

echo "🧹 Web3Games Cleanup Script"
echo "================================"
echo "Namespace: ${NAMESPACE}"
echo ""

if [ "$FORCE" != "true" ]; then
    echo "⚠️  WARNING: This will delete all resources in ${NAMESPACE}"
    echo ""
    read -p "Are you sure you want to continue? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        echo "❌ Cleanup cancelled"
        exit 0
    fi
fi

echo ""
echo "🗑️  Deleting all resources..."

# Delete jobs first (they might be stuck)
echo "Deleting jobs..."
kubectl delete jobs -n ${NAMESPACE} --all --timeout=30s 2>/dev/null || echo "No jobs to delete"

# Delete deployments
echo "Deleting deployments..."
kubectl delete deployments -n ${NAMESPACE} --all --timeout=60s 2>/dev/null || echo "No deployments to delete"

# Delete statefulsets
echo "Deleting statefulsets..."
kubectl delete statefulsets -n ${NAMESPACE} --all --timeout=60s 2>/dev/null || echo "No statefulsets to delete"

# Delete services
echo "Deleting services..."
kubectl delete services -n ${NAMESPACE} --all --timeout=30s 2>/dev/null || echo "No services to delete"

# Delete ingress
echo "Deleting ingress..."
kubectl delete ingress -n ${NAMESPACE} --all --timeout=30s 2>/dev/null || echo "No ingress to delete"

# Delete configmaps (except kube-root-ca.crt)
echo "Deleting configmaps..."
kubectl delete configmap -n ${NAMESPACE} --all --timeout=30s 2>/dev/null || echo "No configmaps to delete"

# Delete secrets (except service account secrets)
echo "Deleting secrets..."
kubectl delete secret -n ${NAMESPACE} --field-selector type!=kubernetes.io/service-account-token --timeout=30s 2>/dev/null || echo "No secrets to delete"

# Delete PVCs
echo "Deleting PVCs..."
read -p "⚠️  Delete persistent volumes? This will DELETE ALL DATA (yes/no): " delete_pvcs
if [ "$delete_pvcs" = "yes" ]; then
    kubectl delete pvc -n ${NAMESPACE} --all --timeout=60s 2>/dev/null || echo "No PVCs to delete"
else
    echo "Skipping PVC deletion (data preserved)"
fi

# Delete network policies
echo "Deleting network policies..."
kubectl delete networkpolicies -n ${NAMESPACE} --all --timeout=30s 2>/dev/null || echo "No network policies to delete"

# Delete HPA
echo "Deleting HPAs..."
kubectl delete hpa -n ${NAMESPACE} --all --timeout=30s 2>/dev/null || echo "No HPAs to delete"

# Delete PDB
echo "Deleting PDBs..."
kubectl delete pdb -n ${NAMESPACE} --all --timeout=30s 2>/dev/null || echo "No PDBs to delete"

# Optionally delete namespace
echo ""
read -p "Delete namespace ${NAMESPACE}? (yes/no): " delete_ns
if [ "$delete_ns" = "yes" ]; then
    kubectl delete namespace ${NAMESPACE} --timeout=120s
    echo "✅ Namespace deleted"
else
    echo "Namespace preserved"
fi

echo ""
echo "✅ Cleanup complete!"
echo ""
echo "📋 Remaining resources in ${NAMESPACE}:"
kubectl get all -n ${NAMESPACE} 2>/dev/null || echo "Namespace does not exist or is empty"

if [ "$delete_pvcs" != "yes" ]; then
    echo ""
    echo "💾 Persistent data is still available:"
    kubectl get pvc -n ${NAMESPACE} 2>/dev/null || echo "No PVCs found"
    echo ""
    echo "💡 To delete PVCs manually:"
    echo "   kubectl delete pvc -n ${NAMESPACE} --all"
fi
