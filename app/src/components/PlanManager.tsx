import React, { useState } from 'react';
import { usePlans, SavedPlan } from '../hooks/usePlans';
import { Button, Modal, Input, Badge } from './ui';

interface PlanManagerProps {
  selectedCourses: Set<string>;
  electiveAssignments: Record<string, string | undefined>;
  offTermCourses: Record<string, string[]>;
  onLoadPlan: (plan: SavedPlan) => void;
}

const PlanManager: React.FC<PlanManagerProps> = ({
  selectedCourses,
  electiveAssignments,
  offTermCourses,
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
        await updatePlan(editingPlanId, planName, selectedCourses, electiveAssignments, offTermCourses);
      } else {
        await savePlan(planName, selectedCourses, electiveAssignments, offTermCourses);
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
    <div className="flex items-center gap-2">
      <Button
        variant="primary"
        size="sm"
        onClick={() => {
          setPlanName('');
          setEditingPlanId(null);
          setShowSaveDialog(true);
        }}
        leadingIcon={
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M5 4h11l3 3v13H5V4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <path d="M8 4v5h7M8 20v-6h8v6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        }
      >
        Save
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setShowLoadDialog(true)}
        disabled={loading || plans.length === 0}
        leadingIcon={
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        }
      >
        Load{plans.length > 0 && ` (${plans.length})`}
      </Button>

      <Modal
        open={showSaveDialog}
        onClose={() => setShowSaveDialog(false)}
        title={editingPlanId ? 'Update plan' : 'Save new plan'}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowSaveDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !planName.trim()}>
              {saving ? 'Saving…' : editingPlanId ? 'Update' : 'Save'}
            </Button>
          </>
        }
      >
        <Input
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
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge tone="primary">{selectedCourses.size} courses</Badge>
          <Badge tone="accent">
            {Object.keys(electiveAssignments).length} electives assigned
          </Badge>
        </div>
      </Modal>

      <Modal
        open={showLoadDialog}
        onClose={() => setShowLoadDialog(false)}
        title="Load saved plan"
        size="md"
        footer={
          <Button variant="ghost" onClick={() => setShowLoadDialog(false)}>
            Close
          </Button>
        }
      >
        {loading ? (
          <p className="text-sm text-muted">Loading plans…</p>
        ) : plans.length === 0 ? (
          <p className="text-sm text-muted">No saved plans. Save a plan first!</p>
        ) : (
          <div className="flex flex-col gap-3">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className="flex flex-wrap items-center justify-between gap-3 border border-border bg-surface-2 p-3.5 transition-colors hover:border-border-strong"
              >
                <div className="min-w-0">
                  <h4 className="truncate font-display text-base font-semibold text-text">
                    {plan.plan_name}
                  </h4>
                  <p className="mt-0.5 text-xs tabular-nums text-muted">
                    {plan.selected_courses.length} courses • Updated{' '}
                    {new Date(plan.updated_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" onClick={() => handleLoad(plan)}>
                    Load
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => handleEdit(plan)}>
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleDelete(plan.id, plan.plan_name)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default PlanManager;
