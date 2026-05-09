import type { MenuItem } from '../types';

type DietaryBadge = {
  key: 'veg' | 'non_veg' | 'eggless';
  label: string;
  className: string;
};

type MenuItemDietaryFields = Pick<MenuItem, 'is_veg' | 'is_non_veg' | 'is_eggless'>;

export function isMenuItemNonVeg(item: MenuItemDietaryFields) {
  return item.is_non_veg === true;
}

export function isMenuItemVeg(item: MenuItemDietaryFields) {
  return item.is_veg === true && !isMenuItemNonVeg(item);
}

export function isMenuItemEggless(item: MenuItemDietaryFields) {
  return item.is_eggless === true && isMenuItemVeg(item);
}

export function getMenuItemDietaryBadges(item: MenuItemDietaryFields): DietaryBadge[] {
  const badges: DietaryBadge[] = [];

  if (isMenuItemVeg(item)) {
    badges.push({
      key: 'veg',
      label: 'Veg',
      className: 'badge-veg',
    });
  }

  if (isMenuItemNonVeg(item)) {
    badges.push({
      key: 'non_veg',
      label: 'Non-Veg',
      className: 'badge-nonveg',
    });
  }

  if (isMenuItemEggless(item)) {
    badges.push({
      key: 'eggless',
      label: 'Eggless',
      className: 'badge-eggless',
    });
  }

  return badges;
}
