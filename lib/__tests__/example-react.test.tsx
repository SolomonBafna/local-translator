import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Simple component for testing
function TestButton({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick}>Click me</button>;
}

describe('React Testing Setup', () => {
  it('renders and responds to user events', async () => {
    const handleClick = vi.fn();
    const user = userEvent.setup();
    
    render(<TestButton onClick={handleClick} />);
    
    const button = screen.getByText('Click me');
    expect(button).toBeDefined();
    
    await user.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});