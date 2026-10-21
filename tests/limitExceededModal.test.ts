import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { LimitExceededModal } from '../components/LimitExceededModal';
import * as capacitorUtils from '../utils/capacitorUtils';

vi.mock('../utils/capacitorUtils', async () => {
  const actual = await vi.importActual('../utils/capacitorUtils');
  return {
    ...actual,
    openExternalSubscriptionPage: vi.fn(),
  };
});

function findButtonWithText(node: any, text: string): any {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'button') {
    const jsonStr = JSON.stringify(node);
    if (jsonStr.includes(text)) return node;
  }
  const children = node.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findButtonWithText(child, text);
      if (found) return found;
    }
  } else if (children) {
    return findButtonWithText(children, text);
  }
  return null;
}

describe('LimitExceededModal component', () => {
  it('destructures userProfile and passes userProfile.uid to openExternalSubscriptionPage when upgrade handler is triggered', async () => {
    const userProfile = {
      uid: 'user_test_987',
      email: 'student@example.com',
      full_name: 'Student Name',
      ai_credits_balance: 10,
    } as any;

    const onClose = vi.fn();

    const element = LimitExceededModal({
      isOpen: true,
      onClose,
      userProfile,
      cost: 100,
      balance: 10,
    }) as React.ReactElement;

    expect(element).not.toBeNull();

    const upgradeButton = findButtonWithText(element, 'Subscribe to Plan');
    expect(upgradeButton).not.toBeNull();
    expect(upgradeButton.props.onClick).toBeDefined();

    // Trigger the upgrade handler
    await upgradeButton.props.onClick();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(capacitorUtils.openExternalSubscriptionPage).toHaveBeenCalledWith('user_test_987');
  });

  it('handles missing userProfile gracefully without throwing an error', async () => {
    const onClose = vi.fn();

    const element = LimitExceededModal({
      isOpen: true,
      onClose,
      cost: 100,
      balance: 0,
    }) as React.ReactElement;

    const upgradeButton = findButtonWithText(element, 'Subscribe to Plan');
    expect(upgradeButton).not.toBeNull();

    await upgradeButton.props.onClick();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(capacitorUtils.openExternalSubscriptionPage).toHaveBeenCalledWith(undefined);
  });
});
