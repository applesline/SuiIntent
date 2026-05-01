import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { LanguageProvider } from './contexts/LanguageContext';
import Layout from './components/layout/Layout';
import Orchestration from './pages/Orchestration';
import Workflows from './pages/Workflows';

function App() {
  const isDevelopment = import.meta.env.DEV;

  return (
    <LanguageProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Orchestration />} />
            <Route path="workflows" element={<Workflows />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Router>
      {isDevelopment && (
        <div className="fixed bottom-4 right-4 z-50">
          {/* ReactQueryDevtools removed for simplicity */}
        </div>
      )}
    </LanguageProvider>
  );
}

export default App;
