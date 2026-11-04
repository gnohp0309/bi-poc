private Map<String, Object> normalizeQueryConfig(Map<String, Object> config) {
  Map<String, Object> normalized = new LinkedHashMap<>(config);

  // 1. Normalize aggregate: ["SUM"] -> "SUM", "sum" -> "SUM"
  Object agg = normalized.get("aggregate");
  if (agg instanceof List) {
    @SuppressWarnings("unchecked")
    List<?> aggList = (List<?>) agg;
    if (!aggList.isEmpty()) {
      agg = aggList.get(0);
    }
  }
  if (agg != null) {
    normalized.put("aggregate", agg.toString().toUpperCase(Locale.ROOT));
  }

  // 2. Normalize dimensions: dimension -> dimensions list
  if (normalized.containsKey("dimension") && !normalized.containsKey("dimensions")) {
    Object dim = normalized.get("dimension");
    if (dim != null && !"null".equals(dim.toString())) {
      normalized.put("dimensions", Collections.singletonList(dim.toString()));
    }
  }

  // 3. Normalize metrics - handle all formats
  Object metricsObj = normalized.get("metrics");
  if (metricsObj instanceof List) {
    @SuppressWarnings("unchecked")
    List<Object> metrics = new ArrayList<>((List<Object>) metricsObj);
    List<Map<String, String>> computedList = new ArrayList<>();

    // Get existing computed_metrics
    Object existingComputed = normalized.get("computed_metrics");
    if (existingComputed instanceof List) {
      @SuppressWarnings("unchecked")
      List<Map<String, String>> existing = (List<Map<String, String>>) existingComputed;
      computedList.addAll(existing);
    } else if (existingComputed instanceof Map) {
      // Normalize {key: expr} -> [{alias: key, expression: expr}]
      @SuppressWarnings("unchecked")
      Map<String, String> computedMap = (Map<String, String>) existingComputed;
      for (Map.Entry<String, String> entry : computedMap.entrySet()) {
        Map<String, String> item = new LinkedHashMap<>();
        item.put("alias", entry.getKey());
        item.put("expression", entry.getValue());
        computedList.add(item);
      }
    }

    // Process each metric
    List<Object> cleanMetrics = new ArrayList<>();
    for (Object m : metrics) {
      if (m == null) continue;

      if (m instanceof String) {
        String metricStr = (String) m;

        // SQL expression with ( or AS -> move to computed_metrics
        if (metricStr.contains("(") || metricStr.toUpperCase(Locale.ROOT).contains(" AS ")) {
          String expr, alias;
          if (metricStr.toUpperCase(Locale.ROOT).contains(" AS ")) {
            String[] parts = metricStr.split("\\s+[Aa][Ss]\\s+", 2);
            expr = parts[0].trim();
            alias = parts.length > 1 ? parts[1].trim() : "result";
          } else {
            expr = metricStr;
            alias = "result";
          }

          Map<String, String> computed = new LinkedHashMap<>();
          computed.put("expression", expr);
          computed.put("alias", alias);
          computedList.add(computed);
        } else {
          // Plain column name or column_suffix
          cleanMetrics.add(metricStr);
        }
      } else if (m instanceof Map) {
        // Normalize Map keys: field/name -> column
        @SuppressWarnings("unchecked")
        Map<String, Object> metricMap = new LinkedHashMap<>((Map<String, Object>) m);

        // Normalize key names
        if (metricMap.containsKey("field") && !metricMap.containsKey("column")) {
          metricMap.put("column", metricMap.remove("field"));
        } else if (metricMap.containsKey("name") && !metricMap.containsKey("column")) {
          metricMap.put("column", metricMap.remove("name"));
        }

        // Normalize aggregate key
        if (metricMap.containsKey("agg") && !metricMap.containsKey("aggregate")) {
          metricMap.put("aggregate", metricMap.remove("agg"));
        }
        if (metricMap.containsKey("aggregate")) {
          Object aggVal = metricMap.get("aggregate");
          metricMap.put("aggregate", aggVal.toString().toUpperCase(Locale.ROOT));
        }

        cleanMetrics.add(metricMap);
      } else {
        cleanMetrics.add(m);
      }
    }

    normalized.put("metrics", cleanMetrics);
    if (!computedList.isEmpty()) {
      normalized.put("computed_metrics", computedList);
    }
  }

  // 4. Normalize computed_metrics keys
  Object computedObj = normalized.get("computed_metrics");
  if (computedObj instanceof List) {
    @SuppressWarnings("unchecked")
    List<Map<String, String>> computedList = (List<Map<String, String>>) computedObj;
    for (Map<String, String> comp : computedList) {
      // Normalize expr -> expression
      if (comp.containsKey("expr") && !comp.containsKey("expression")) {
        comp.put("expression", comp.remove("expr"));
      }
      // Normalize name -> alias
      if (comp.containsKey("name") && !comp.containsKey("alias")) {
        comp.put("alias", comp.remove("name"));
      }
    }
  }

  // 5. Remove metrics that conflict with computed_metrics aliases
  metricsObj = normalized.get("metrics");
  computedObj = normalized.get("computed_metrics");
  if (metricsObj instanceof List && computedObj instanceof List) {
    @SuppressWarnings("unchecked")
    List<Object> metrics = new ArrayList<>((List<Object>) metricsObj);
    @SuppressWarnings("unchecked")
    List<Map<String, String>> computedList = (List<Map<String, String>>) computedObj;

    Set<String> computedAliases = new HashSet<>();
    for (Map<String, String> comp : computedList) {
      String alias = comp.get("alias");
      if (alias != null) {
        computedAliases.add(alias);
      }
    }

    metrics.removeIf(metric -> {
      if (metric == null) return true;
      String metricName = metric instanceof String ? (String) metric :
                         (metric instanceof Map ?
                           String.valueOf(((Map<?, ?>) metric).get("column")) : null);
      return metricName != null && computedAliases.contains(metricName);
    });

    normalized.put("metrics", metrics);
  }

  return normalized;
}
