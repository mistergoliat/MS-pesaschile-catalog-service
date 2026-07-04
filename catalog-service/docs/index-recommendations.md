# Recommended Indexes for Manual Review

No schema changes are executed by the service. If the PrestaShop instance shows slow queries, review these candidates manually:

- `ps_product(active, id_product)`
- `ps_product_lang(id_product, id_lang, id_shop)`
- `ps_product_attribute(id_product, id_product_attribute)`
- `ps_product_attribute_shop(id_product_attribute, id_shop)`
- `ps_stock_available(id_product, id_product_attribute, id_shop)`
- `ps_specific_price(id_product, id_product_attribute, id_shop, id_currency, id_country, id_group, id_customer, from_quantity)`
- `ps_product_attribute_combination(id_product_attribute, id_attribute)`
- `ps_attribute(id_attribute, id_attribute_group)`
- `ps_attribute_lang(id_attribute, id_lang)`
- `ps_attribute_group_lang(id_attribute_group, id_lang)`
