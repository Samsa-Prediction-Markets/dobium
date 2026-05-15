// ============================================================================
// MARKET MODEL
// ============================================================================
// Represents a prediction market

const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const Market = sequelize.define('Market', {
  id: {
    type: DataTypes.STRING(50),
    primaryKey: true,
    allowNull: false
  },
  title: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [10, 255]
    }
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  category: {
    type: DataTypes.STRING(50),
    allowNull: false,
    validate: {
      isIn: [[
        'politics', 'sports', 'crypto', 'technology',
        'finance', 'entertainment', 'international',
        'climate', 'science', 'health', 'environment',
        'arts_and_culture'
      ]]
    }
  },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'active',
    validate: {
      isIn: [['active', 'resolved', 'closed']]
    }
  },
  close_date: {
    type: DataTypes.DATE,
    allowNull: true
  },
  resolution_date: {
    type: DataTypes.DATE,
    allowNull: true
  },
  total_volume: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  image_url: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  winning_outcome_id: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  search_keywords: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  market_type: {
    type: DataTypes.STRING(30),
    defaultValue: 'binary',
    validate: {
      isIn: [['binary', 'multi_single', 'multi_multiple']]
    }
  }
}, {
  tableName: 'markets',
  timestamps: true,
  underscored: true, // Use snake_case for column names (created_at, updated_at)
  indexes: [
    { fields: ['status'] },
    { fields: ['category'] },
    { fields: ['close_date'] }
  ]
});

module.exports = Market;

