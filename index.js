for (let i = 1; i <= 45; i++) {
  setTimeout(() => {
    console.log(i);
  }, (i-1) * 1000);
}