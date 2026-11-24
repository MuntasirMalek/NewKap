import React from 'react';

class SentryErrorBoundary extends React.Component<{children: React.ReactNode}> {
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(error, errorInfo);
  }

  render() {
    return this.props.children;
  }
}

export default SentryErrorBoundary;
