function quickSort(arr) {
  if (arr.length <= 1) return arr;
  const pivot = arr[Math.floor(arr.length / 2)];
  const left = arr.filter(item => item < pivot);
  const middle = arr.filter(item => item === pivot);
  const right = arr.filter(item => item > pivot);
  return [...quickSort(left), ...middle, ...quickSort(right)];
}