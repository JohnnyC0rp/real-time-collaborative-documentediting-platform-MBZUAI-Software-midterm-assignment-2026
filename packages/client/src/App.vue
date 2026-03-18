<template>
  <main class="app-shell">
    <header class="app-header">
      <h1>Collaborative Document Editor PoC</h1>
      <p>Vue frontend + Express API + PostgreSQL contract validation.</p>
    </header>
    <RouterView />
  </main>
</template>

<script setup lang="ts">
import { RouterView } from "vue-router";
</script>
