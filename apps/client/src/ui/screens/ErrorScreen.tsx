import { useServices } from '../context';
import { useStore } from '../hooks/useStore';

export function ErrorScreen() {
  const { stores } = useServices();
  const error = useStore(stores.app, (s) => s.error);
  return (
    <div className="pw-error" role="alert">
      <div className="pw-panel pw-panel--ornate pw-error__box">
        <h2>PROJECT WORLD</h2>
        <p>{error}</p>
      </div>
    </div>
  );
}
