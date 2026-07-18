export const metadata = { title: 'Product Engine' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#0f1115', color: '#e7e9ee' }}>
        {children}
      </body>
    </html>
  );
}
