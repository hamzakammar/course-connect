import React, { useState } from 'react';
import { usePlans, SavedPlan } from '../hooks/usePlans';
import './PlanManager.css';

interface PlanManagerProps {
  selectedCourses: Set<string>;
  electiveAssignments: Record<string, string | undefined>;
  onLoadPlan: (plan: SavedPlan) => void;
}

const PlanManager: React.FC<PlanManagerProps> = ({
  selectedCourses,
  electiveAssignments,
  onLoadPlan,
}) => {
  const { plans, loading, savePlan, updatePlan, deletePlan } = usePlans();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [planName, setPlanName] = useState('');
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!planName.trim()) {
      alert('Please enter a plan name');
      return;
    }

    setSaving(true);
    try {
      if (editingPlanId) {
        await updatePlan(editingPlanId, planName, selectedCourses, electiveAssignments);
      } else {
        await savePlan(planName, selectedCourses, electiveAssignments);
      }
      setShowSaveDialog(false);
      setPlanName('');
      setEditingPlanId(null);
    } catch (err: any) {
      console.error('Save plan error:', err);
      let errorMessage = 'Failed to save plan';
      
      if (err?.code === '42P01') {
        errorMessage = 'Database table "user_plans" does not exist. Please run the SQL migration in Supabase.';
      } else if (err?.code === '42501') {
        errorMessage = 'Permission denied. Check your Supabase RLS policies.';
      } else if (err?.message) {
        errorMessage = `Failed to save plan: ${err.message}`;
      } else if (err?.error?.message) {
        errorMessage = `Failed to save plan: ${err.error.message}`;
      } else {
        errorMessage = `Failed to save plan: ${JSON.stringify(err)}`;
      }
      
      alert(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (planId: string, planName: string) => {
    if (!confirm(`Delete plan "${planName}"?`)) return;

    try {
      await deletePlan(planId);
    } catch (err) {
      alert('Failed to delete plan: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleLoad = (plan: SavedPlan) => {
    if (!confirm(`Load plan "${plan.plan_name}"? This will replace your current selections.`)) {
      return;
    }
    onLoadPlan(plan);
    setShowLoadDialog(false);
  };

  const handleEdit = (plan: SavedPlan) => {
    setPlanName(plan.plan_name);
    setEditingPlanId(plan.id);
    setShowSaveDialog(true);
  };

  return (
    <div className="plan-manager">
      <div className="plan-manager-actions">
        <button
          className="plan-button save-button"
          onClick={() => {
            setPlanName('');
            setEditingPlanId(null);
            setShowSaveDialog(true);
          }}
        >
          💾 Save Plan
        </button>
        <button
          className="plan-button load-button"
          onClick={() => setShowLoadDialog(true)}
          disabled={loading || plans.length === 0}
        >
          📂 Load Plan {plans.length > 0 && `(${plans.length})`}
        </button>
      </div>

      {showSaveDialog && (
        <div className="plan-dialog-overlay" onClick={() => setShowSaveDialog(false)}>
          <div className="plan-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{editingPlanId ? 'Update Plan' : 'Save New Plan'}</h3>
            <input
              type="text"
              placeholder="Plan name"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') setShowSaveDialog(false);
              }}
              autoFocus
            />
            <div className="plan-dialog-info">
              <p>Courses: {selectedCourses.size}</p>
              <p>Electives assigned: {Object.keys(electiveAssignments).length}</p>
            </div>
            <div className="plan-dialog-actions">
              <button onClick={() => setShowSaveDialog(false)}>Cancel</button>
              <button onClick={handleSave} disabled={saving || !planName.trim()}>
                {saving ? 'Saving...' : editingPlanId ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showLoadDialog && (
        <div className="plan-dialog-overlay" onClick={() => setShowLoadDialog(false)}>
          <div className="plan-dialog plan-load-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Load Saved Plan</h3>
            {loading ? (
              <p>Loading plans...</p>
            ) : plans.length === 0 ? (
              <p>No saved plans. Save a plan first!</p>
            ) : (
              <div className="plan-list">
                {plans.map((plan) => (
                  <div key={plan.id} className="plan-item">
                    <div className="plan-item-main">
                      <div className="plan-item-info">
                        <h4>{plan.plan_name}</h4>
                        <p className="plan-meta">
                          {plan.selected_courses.length} courses • 
                          Updated {new Date(plan.updated_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="plan-item-actions">
                        <button
                          className="plan-item-button load"
                          onClick={() => handleLoad(plan)}
                        >
                          Load
                        </button>
                        <button
                          className="plan-item-button edit"
                          onClick={() => handleEdit(plan)}
                        >
                          Edit
                        </button>
                        <button
                          className="plan-item-button delete"
                          onClick={() => handleDelete(plan.id, plan.plan_name)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="plan-dialog-actions">
              <button onClick={() => setShowLoadDialog(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlanManager;

