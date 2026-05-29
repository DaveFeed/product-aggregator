import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ChatPage from './pages/ChatPage'
import AnalyticsPage from './pages/AnalyticsPage'

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="min-h-screen bg-gray-50">
          <nav className="bg-white shadow-sm border-b border-gray-200 px-4 py-3">
            <div className="max-w-6xl mx-auto flex items-center justify-between">
              <h1 className="text-xl font-semibold text-gray-800">Product Aggregator</h1>
              <div className="flex gap-4">
                <a href="/chat" className="text-blue-600 hover:text-blue-800">Chat</a>
                <a href="/analytics" className="text-blue-600 hover:text-blue-800">Analytics</a>
              </div>
            </div>
          </nav>
          <Routes>
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/analytics/:productId?" element={<AnalyticsPage />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
