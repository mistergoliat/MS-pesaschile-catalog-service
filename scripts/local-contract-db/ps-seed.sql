-- R4-J1C local integration DB: SYNTHETIC PrestaShop 1.7/8 subset.
-- No production data. Column names follow the PrestaShop core schema
-- (notably ps_feature_value has `custom`, NOT `custom_value`).
SET NAMES utf8mb4;
SET SESSION sql_mode = 'NO_ENGINE_SUBSTITUTION';

CREATE TABLE ps_product (
  id_product INT UNSIGNED NOT NULL PRIMARY KEY,
  id_manufacturer INT UNSIGNED NOT NULL DEFAULT 0,
  id_category_default INT UNSIGNED DEFAULT NULL,
  reference VARCHAR(64) DEFAULT NULL,
  price DECIMAL(20,6) NOT NULL DEFAULT 0,
  weight DECIMAL(20,6) NOT NULL DEFAULT 0,
  active TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
  available_for_order TINYINT(1) NOT NULL DEFAULT 1,
  visibility ENUM('both','catalog','search','none') NOT NULL DEFAULT 'both',
  date_upd DATETIME NOT NULL DEFAULT '2026-09-01 00:00:00'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE ps_product_shop (
  id_product INT UNSIGNED NOT NULL,
  id_shop INT UNSIGNED NOT NULL,
  id_category_default INT UNSIGNED DEFAULT NULL,
  price DECIMAL(20,6) NOT NULL DEFAULT 0,
  active TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
  available_for_order TINYINT(1) NOT NULL DEFAULT 1,
  visibility ENUM('both','catalog','search','none') NOT NULL DEFAULT 'both',
  PRIMARY KEY (id_product, id_shop)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE ps_product_lang (
  id_product INT UNSIGNED NOT NULL,
  id_shop INT UNSIGNED NOT NULL DEFAULT 1,
  id_lang INT UNSIGNED NOT NULL,
  description TEXT,
  description_short TEXT,
  link_rewrite VARCHAR(128) NOT NULL,
  name VARCHAR(128) NOT NULL,
  PRIMARY KEY (id_product, id_shop, id_lang)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE ps_category_lang (
  id_category INT UNSIGNED NOT NULL,
  id_shop INT UNSIGNED NOT NULL DEFAULT 1,
  id_lang INT UNSIGNED NOT NULL,
  name VARCHAR(128) NOT NULL,
  PRIMARY KEY (id_category, id_shop, id_lang)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE ps_manufacturer (
  id_manufacturer INT UNSIGNED NOT NULL PRIMARY KEY,
  name VARCHAR(64) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE ps_product_attribute (
  id_product_attribute INT UNSIGNED NOT NULL PRIMARY KEY,
  id_product INT UNSIGNED NOT NULL,
  reference VARCHAR(64) DEFAULT NULL,
  price DECIMAL(20,6) NOT NULL DEFAULT 0,
  default_on TINYINT(1) UNSIGNED DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE ps_product_attribute_shop (
  id_product INT UNSIGNED NOT NULL,
  id_product_attribute INT UNSIGNED NOT NULL,
  id_shop INT UNSIGNED NOT NULL,
  price DECIMAL(20,6) NOT NULL DEFAULT 0,
  default_on TINYINT(1) UNSIGNED DEFAULT NULL,
  PRIMARY KEY (id_product_attribute, id_shop)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE ps_product_attribute_combination (
  id_attribute INT UNSIGNED NOT NULL,
  id_product_attribute INT UNSIGNED NOT NULL,
  PRIMARY KEY (id_attribute, id_product_attribute)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE ps_attribute (
  id_attribute INT UNSIGNED NOT NULL PRIMARY KEY,
  id_attribute_group INT UNSIGNED NOT NULL,
  color VARCHAR(32) NOT NULL DEFAULT '',
  position INT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE ps_attribute_lang (
  id_attribute INT UNSIGNED NOT NULL,
  id_lang INT UNSIGNED NOT NULL,
  name VARCHAR(128) NOT NULL,
  PRIMARY KEY (id_attribute, id_lang)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE ps_attribute_group_lang (
  id_attribute_group INT UNSIGNED NOT NULL,
  id_lang INT UNSIGNED NOT NULL,
  name VARCHAR(128) NOT NULL,
  public_name VARCHAR(64) NOT NULL,
  PRIMARY KEY (id_attribute_group, id_lang)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE ps_stock_available (
  id_stock_available INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  id_product INT UNSIGNED NOT NULL,
  id_product_attribute INT UNSIGNED NOT NULL,
  id_shop INT UNSIGNED NOT NULL,
  id_shop_group INT UNSIGNED NOT NULL DEFAULT 0,
  quantity INT NOT NULL DEFAULT 0,
  physical_quantity INT NOT NULL DEFAULT 0,
  reserved_quantity INT NOT NULL DEFAULT 0,
  depends_on_stock TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
  out_of_stock TINYINT(1) UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE ps_feature (
  id_feature INT UNSIGNED NOT NULL PRIMARY KEY,
  position INT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE ps_feature_lang (
  id_feature INT UNSIGNED NOT NULL,
  id_lang INT UNSIGNED NOT NULL,
  name VARCHAR(128) DEFAULT NULL,
  PRIMARY KEY (id_feature, id_lang)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE ps_feature_product (
  id_feature INT UNSIGNED NOT NULL,
  id_product INT UNSIGNED NOT NULL,
  id_feature_value INT UNSIGNED NOT NULL,
  PRIMARY KEY (id_feature, id_product, id_feature_value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE ps_feature_value (
  id_feature_value INT UNSIGNED NOT NULL PRIMARY KEY,
  id_feature INT UNSIGNED NOT NULL,
  custom TINYINT(3) UNSIGNED DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE ps_feature_value_lang (
  id_feature_value INT UNSIGNED NOT NULL,
  id_lang INT UNSIGNED NOT NULL,
  value VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (id_feature_value, id_lang)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE ps_specific_price (
  id_specific_price INT UNSIGNED NOT NULL PRIMARY KEY,
  id_specific_price_rule INT UNSIGNED NOT NULL DEFAULT 0,
  id_cart INT UNSIGNED NOT NULL DEFAULT 0,
  id_product INT UNSIGNED NOT NULL,
  id_shop INT UNSIGNED NOT NULL DEFAULT 1,
  id_shop_group INT UNSIGNED NOT NULL DEFAULT 0,
  id_currency INT UNSIGNED NOT NULL DEFAULT 0,
  id_country INT UNSIGNED NOT NULL DEFAULT 0,
  id_group INT UNSIGNED NOT NULL DEFAULT 0,
  id_customer INT UNSIGNED NOT NULL DEFAULT 0,
  id_product_attribute INT UNSIGNED NOT NULL DEFAULT 0,
  price DECIMAL(20,6) NOT NULL DEFAULT -1,
  from_quantity MEDIUMINT(8) UNSIGNED NOT NULL DEFAULT 1,
  reduction DECIMAL(20,6) NOT NULL DEFAULT 0,
  reduction_tax TINYINT(1) NOT NULL DEFAULT 1,
  reduction_type ENUM('amount','percentage') NOT NULL DEFAULT 'amount',
  `from` DATETIME NOT NULL DEFAULT '0000-00-00 00:00:00',
  `to` DATETIME NOT NULL DEFAULT '0000-00-00 00:00:00'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE ps_configuration (
  id_configuration INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  id_shop_group INT UNSIGNED DEFAULT NULL,
  id_shop INT UNSIGNED DEFAULT NULL,
  name VARCHAR(254) NOT NULL,
  value TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------- data
INSERT INTO ps_configuration (name, value) VALUES ('PS_ORDER_OUT_OF_STOCK', '0');
INSERT INTO ps_category_lang VALUES (3, 1, 1, 'Barras'), (4, 1, 1, 'Discos');
INSERT INTO ps_manufacturer VALUES (7, 'MarcaSintetica');

-- P10 simple, in stock, one specification.
INSERT INTO ps_product (id_product, id_manufacturer, id_category_default, reference, price, weight, active, available_for_order, visibility) VALUES (10, 0, 3, 'BAR-10', 100000, 20, 1, 1, 'both');
INSERT INTO ps_product_shop VALUES (10, 1, 3, 100000, 1, 1, 'both');
INSERT INTO ps_product_lang VALUES (10, 1, 1, '<p>Barra olímpica larga</p>', '<p>Barra comercial</p>', 'barra-olimpica', 'Barra olímpica');
INSERT INTO ps_stock_available (id_product, id_product_attribute, id_shop, quantity, physical_quantity, reserved_quantity, out_of_stock) VALUES (10, 0, 1, 4, 6, 2, 2);
INSERT INTO ps_feature VALUES (1, 1);
INSERT INTO ps_feature_lang VALUES (1, 1, 'Largo');
INSERT INTO ps_feature_value VALUES (100, 1, 0);
INSERT INTO ps_feature_value_lang VALUES (100, 1, '220 cm');
INSERT INTO ps_feature_product VALUES (1, 10, 100);

-- P12 simple with an UNLIMITED 10% promotion stored the PrestaShop way (zero dates).
INSERT INTO ps_product (id_product, id_manufacturer, id_category_default, reference, price, weight, active, available_for_order, visibility) VALUES (12, 7, 3, 'BAR-12', 100000, 15, 1, 1, 'both');
INSERT INTO ps_product_shop VALUES (12, 1, 3, 100000, 1, 1, 'both');
INSERT INTO ps_product_lang VALUES (12, 1, 1, '', 'Barra técnica', 'barra-tecnica', 'Barra técnica promo');
INSERT INTO ps_stock_available (id_product, id_product_attribute, id_shop, quantity, physical_quantity, reserved_quantity, out_of_stock) VALUES (12, 0, 1, 3, 3, 0, 2);
INSERT INTO ps_specific_price (id_specific_price, id_product, id_shop, price, from_quantity, reduction, reduction_tax, reduction_type, `from`, `to`) VALUES (50, 12, 0, -1, 1, 0.100000, 1, 'percentage', '0000-00-00 00:00:00', '0000-00-00 00:00:00');

-- P20 with two variants (V7 XL in stock +10000 net, V8 L out of stock).
INSERT INTO ps_product (id_product, id_manufacturer, id_category_default, reference, price, weight, active, available_for_order, visibility) VALUES (20, 0, 3, 'BAR-20', 100000, 20, 1, 1, 'both');
INSERT INTO ps_product_shop VALUES (20, 1, 3, 100000, 1, 1, 'both');
INSERT INTO ps_product_lang VALUES (20, 1, 1, '', 'Variantes', 'barra-con-opciones', 'Barra con opciones');
INSERT INTO ps_product_attribute VALUES (7, 20, 'BAR-20-XL', 10000, 1), (8, 20, 'BAR-20-L', 0, NULL);
INSERT INTO ps_product_attribute_shop VALUES (20, 7, 1, 10000, 1), (20, 8, 1, 0, NULL);
INSERT INTO ps_attribute VALUES (70, 5, '', 0), (80, 5, '', 1);
INSERT INTO ps_attribute_lang VALUES (70, 1, 'XL'), (80, 1, 'L');
INSERT INTO ps_attribute_group_lang VALUES (5, 1, 'Tamaño', 'Tamaño');
INSERT INTO ps_product_attribute_combination VALUES (70, 7), (80, 8);
INSERT INTO ps_stock_available (id_product, id_product_attribute, id_shop, quantity, physical_quantity, reserved_quantity, out_of_stock) VALUES (20, 0, 1, 2, 2, 0, 2), (20, 7, 1, 2, 2, 0, 2), (20, 8, 1, 0, 0, 0, 2);

-- P40 inactive (found, not_sellable/inactive; excluded from search).
INSERT INTO ps_product (id_product, id_category_default, reference, price, active, available_for_order, visibility) VALUES (40, NULL, 'OLD-40', 100000, 0, 1, 'both');
INSERT INTO ps_product_shop VALUES (40, 1, NULL, 100000, 0, 1, 'both');
INSERT INTO ps_product_lang VALUES (40, 1, 1, '', NULL, 'producto-descontinuado', 'Producto descontinuado barra');
INSERT INTO ps_stock_available (id_product, id_product_attribute, id_shop, quantity, out_of_stock) VALUES (40, 0, 1, 0, 2);

-- P41 not listed (visibility none).
INSERT INTO ps_product (id_product, id_category_default, reference, price, active, available_for_order, visibility) VALUES (41, 3, 'HID-41', 50000, 1, 1, 'none');
INSERT INTO ps_product_shop VALUES (41, 1, 3, 50000, 1, 1, 'none');
INSERT INTO ps_product_lang VALUES (41, 1, 1, '', NULL, 'barra-oculta', 'Barra oculta');
INSERT INTO ps_stock_available (id_product, id_product_attribute, id_shop, quantity, out_of_stock) VALUES (41, 0, 1, 5, 2);

-- P50 simple without any stock_available row (stock unknown).
INSERT INTO ps_product (id_product, id_category_default, reference, price, active, available_for_order, visibility) VALUES (50, 4, 'DSC-50', 20000, 1, 1, 'both');
INSERT INTO ps_product_shop VALUES (50, 1, 4, 20000, 1, 1, 'both');
INSERT INTO ps_product_lang VALUES (50, 1, 1, '', 'Disco bumper', 'disco-bumper', 'Disco bumper 10 kg');

-- P51 simple, zero stock, product-level out_of_stock=1 (backorder allowed).
INSERT INTO ps_product (id_product, id_category_default, reference, price, active, available_for_order, visibility) VALUES (51, 4, 'DSC-51', 30000, 1, 1, 'both');
INSERT INTO ps_product_shop VALUES (51, 1, 4, 30000, 1, 1, 'both');
INSERT INTO ps_product_lang VALUES (51, 1, 1, '', 'Disco a pedido', 'disco-pedido', 'Disco a pedido 20 kg');
INSERT INTO ps_stock_available (id_product, id_product_attribute, id_shop, quantity, out_of_stock) VALUES (51, 0, 1, 0, 1);

-- P444 internal product (excluded by policy even though it matches "barra").
INSERT INTO ps_product (id_product, id_category_default, reference, price, active, available_for_order, visibility) VALUES (444, 3, 'SRV-444', 1, 1, 1, 'both');
INSERT INTO ps_product_shop VALUES (444, 1, 3, 1, 1, 1, 'both');
INSERT INTO ps_product_lang VALUES (444, 1, 1, '', NULL, 'servicio', 'Servicio vendedor barra');
INSERT INTO ps_stock_available (id_product, id_product_attribute, id_shop, quantity, out_of_stock) VALUES (444, 0, 1, 99, 2);

-- Read-only account used by catalog-service (SELECT only).
CREATE USER IF NOT EXISTS 'catalog_reader'@'%' IDENTIFIED BY 'j1c-local-reader-pw';
GRANT SELECT ON prestashop_j1c.* TO 'catalog_reader'@'%';
FLUSH PRIVILEGES;
