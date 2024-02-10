#!/usr/bin/python
# -*- coding: utf8 -*-
import time, string, math

class SparsePhoneBook():
    """A sparse list that returns the reversed identity for a given index, prefixed with
       a prefix."""
    def __init__(self, prefix="079"):
        self._length = 10000000
        self._prefix = prefix

    def __len__(self):
        return self._length

    def __getitem__(self, i):
        if type(i) is not int:
            raise IndexError("Invalid index: " + str(i))
        if i < 0:
            i += len(self)
        if 0 <= i < len(self):
            return self._prefix + format(len(self) - 1 - i, "0" + str(int(math.log10(len(self)))) + "n")
        raise IndexError("Index out of range: " + str(i))

class SparseList():
    """A sparse, alphabetically sorted list that deterministically returns a
       name for each given index, except for a secret key/value pair."""
    def __init__(self, length, secret_key, secret_value, delay=0):
        self._delay = delay
        self._length = length
        self._secret_key = secret_key
        self._secret_value = secret_value
        self._vowels = 'aeiou'
        self._consonants = [ch for ch in string.ascii_lowercase if ch not in self._vowels]
        self._doubles = 'bdfglmnprst'
        self._followers = sorted(self._vowels + self._doubles)

    def __len__(self):
        return self._length
    
    def _next_alphabet(self, last):
        last = last.lower()
        if last[-1] in self._vowels:
            return self._consonants
        if len(last) < 2:
            return self._vowels
        if last[-2] in self._consonants:
            return self._vowels
        return self._followers
    
    def _generate_name(self, i):
        """Deterministically generate the name at index i from the available alphabet before secret_value."""

        if i == self._secret_key:
            return self._secret_value
        if i < self._secret_key:
            start = 0
            end = self._secret_key
            alphabet = string.ascii_uppercase[0:string.ascii_uppercase.index(self._secret_value[0])]
            l = len(alphabet)
        else:
            start = self._secret_key + 1
            end = len(self)
            alphabet = string.ascii_uppercase[string.ascii_uppercase.index(self._secret_value[0])+1:]
            i -= self._secret_key + 1

        # Split [start:end] into l equal-sized intervals of a length of about interval/l
        l = len(alphabet)
        d = math.ceil((end - start) / l)
        index = int(i // d)
        name = alphabet[index]
        i = i % d

        while d > 1:
            alphabet = self._next_alphabet(name)
            l = len(alphabet)
            d = math.ceil(d / l)
            index = int(i // d)
            name += alphabet[index]
            i = i % d
        return name

    def __getitem__(self, i):
        time.sleep(self._delay)
        if type(i) is not int:
            raise IndexError("Invalid index: " + str(i))
        if i < 0:
            i += len(self)
        if i == self._secret_key:
            return self._secret_value
        return self._generate_name(i)

numbers = SparsePhoneBook("079")
names = SparseList(10000000, 3953842, 'Lyanna')