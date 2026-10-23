import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import CostingSimulator from './CostingSimulator.jsx';
import { Alert, Loading } from './ui.jsx';

/** Costing tab of a product: live "what-if" calculation, saved only on request. */
export default function CostingPanel({ productId, onSaved }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api(`/products/${productId}/costing`).then(setData).catch(setError);
  }, [productId]);

  if (error) return <Alert tone="error">{error.message}</Alert>;
  if (!data) return <Loading />;

  const save = async (payload) => {
    const r = await api(`/products/${productId}/costing`, { method: 'PUT', body: payload });
    setData(r);
    toast.success('Costing saved');
    onSaved?.();
  };

  return (
    <div className="stack">
      <div className="row small muted"><Lock size={14} /> Visible only to roles with costing access. Every view is logged.</div>
      <CostingSimulator data={data} onSave={data.can_edit || data.can_edit_defaults ? save : undefined} />
    </div>
  );
}
